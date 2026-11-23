"""ffmpeg / whisper wrappers."""
import json, os, re, shutil, subprocess, urllib.request

MODEL_DIR = os.path.expanduser("~/.cache/daisy-video/models")
MODEL = os.path.join(MODEL_DIR, "ggml-base.en.bin")
MODEL_URL = "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.en.bin"

# Voice cleanup chosen for Daisy Debate videos ("B / gentler"): rumble cut, light denoise,
# gentle compression, slight 6.5 kHz dip for harshness. No de-esser (it sounded bad).
# The loudness gain is measured per video and inserted where {gain} sits.
AUDIO_PRE = ("highpass=f=80,volume=30dB,afftdn=nr=6:nf=-50:tn=1,"
             "acompressor=threshold=-26dB:ratio=2:attack=20:release=250:makeup=1,"
             "equalizer=f=6500:t=o:w=1.2:g=-2.5,alimiter=limit=0.8:attack=5:release=80:level=false")
AUDIO_POST = "volume={gain:.2f}dB,alimiter=limit=0.83:attack=5:release=80:level=false,aresample=48000"
TARGET_LUFS = -16.0   # YouTube normalises to about -14; -16 leaves headroom and sounds natural


def run(cmd, **kw):
    r = subprocess.run(cmd, capture_output=True, text=True, **kw)
    if r.returncode:
        raise RuntimeError(f"command failed: {' '.join(cmd[:4])} ...\n{r.stderr[-2000:]}")
    return r


def need(tool):
    if not shutil.which(tool):
        raise SystemExit(f"missing {tool}: brew install {'whisper-cpp' if tool == 'whisper-cli' else 'ffmpeg'}")


def probe(path):
    need("ffprobe")
    r = run(["ffprobe", "-v", "error", "-select_streams", "v:0", "-show_entries",
             "stream=width,height,r_frame_rate:format=duration", "-of", "json", path])
    j = json.loads(r.stdout)
    s = j["streams"][0]
    num, den = s["r_frame_rate"].split("/")
    return dict(w=int(s["width"]), h=int(s["height"]), fps=round(int(num) / int(den)),
                duration=float(j["format"]["duration"]))


def measure_lufs(src, chain):
    """Integrated loudness after `chain`."""
    r = subprocess.run(["ffmpeg", "-hide_banner", "-nostats", "-i", src, "-vn", "-af",
                        chain + ",loudnorm=print_format=json", "-f", "null", "-"], capture_output=True, text=True)
    m = re.search(r"\{[^{}]*\"input_i\"[^{}]*\}", r.stderr)
    if not m: raise RuntimeError("loudness measurement failed:\n" + r.stderr[-1500:])
    return float(json.loads(m.group(0))["input_i"])


def audio_chain(src, log=print):
    pre = measure_lufs(src, AUDIO_PRE)
    gain = TARGET_LUFS - pre
    log(f"  speech loudness after cleanup {pre:.1f} LUFS, adding {gain:+.2f} dB")
    return AUDIO_PRE + "," + AUDIO_POST.format(gain=gain)


def transcribe(src, srt_out, log=print):
    need("whisper-cli"); need("ffmpeg")
    if not os.path.exists(MODEL):
        os.makedirs(MODEL_DIR, exist_ok=True)
        log(f"  downloading whisper model to {MODEL}")
        urllib.request.urlretrieve(MODEL_URL, MODEL)
    wav = os.path.splitext(srt_out)[0] + ".16k.wav"
    run(["ffmpeg", "-y", "-i", src, "-vn", "-ac", "1", "-ar", "16000", wav])
    run(["whisper-cli", "-m", MODEL, "-f", wav, "-osrt", "-of", os.path.splitext(srt_out)[0]])
    os.remove(wav)


def srt_to_text(srt):
    """'[m:ss] text' lines — compact form for writing cards."""
    out = []
    for block in open(srt).read().strip().split("\n\n"):
        ls = block.strip().splitlines()
        if len(ls) < 3: continue
        h, m, s = ls[1].split(" --> ")[0].replace(",", ".").split(":")
        sec = int(h) * 3600 + int(m) * 60 + float(s)
        out.append(f"[{int(sec // 60)}:{sec % 60:04.1f}] {' '.join(ls[2:]).strip()}")
    return "\n".join(out) + "\n"


def frame(src, seconds, out):
    run(["ffmpeg", "-y", "-ss", f"{seconds:.3f}", "-i", src, "-map", "0:v:0", "-frames:v", "1", out])


def compose(src, overlay_list, out, info, audio_af, log=print):
    vf = (f"[0:v:0]setpts=PTS-STARTPTS[base];"
          f"[1:v]fps={info['fps']},scale={info['w']}:{info['h']}:flags=lanczos,format=rgba,setpts=PTS-STARTPTS[ov];"
          f"[base][ov]overlay=0:0:eof_action=pass:shortest=0[v]")
    bitrate = "8M" if info["h"] <= 720 else "14M"
    cmd = ["ffmpeg", "-y", "-hide_banner", "-loglevel", "error", "-stats", "-i", src,
           "-f", "concat", "-safe", "0", "-i", overlay_list,
           "-filter_complex", vf, "-map", "[v]", "-map", "0:a:0", "-af", audio_af,
           "-c:v", "h264_videotoolbox", "-b:v", bitrate, "-pix_fmt", "yuv420p",
           "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart", "-t", f"{info['duration']:.3f}", out]
    log("  encoding " + out)
    subprocess.run(cmd, check=True)
