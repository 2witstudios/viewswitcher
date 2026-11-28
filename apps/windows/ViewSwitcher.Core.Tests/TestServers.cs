using System.Diagnostics;
using System.Net;
using System.Net.Sockets;
using System.Text;

namespace ViewSwitcher.Core.Tests;

/// <summary>Stub servers for the controller and supervisor tests (Kit's TestServers.swift): Bun scripts started for real.</summary>
public static class TestServers
{
    public const string StateJson = """{"onAir":null,"obs":{"connected":false,"recording":false,"streaming":false},"obsSetup":null,"usb":{"enabled":false,"attached":false,"connected":false},"warnings":[]}""";

    /// <summary>Like the real server: stops when its stdin closes (the app's stop on Windows).</summary>
    public const string StopsOnStdin = "process.stdin.on('end', () => process.exit(0)); process.stdin.resume();";

    public static readonly string Serving = $"{StopsOnStdin} Bun.serve({{ hostname: '127.0.0.1', port: Number(process.env.PORT), fetch: () => Response.json({StateJson}) }}); console.log('stub up');";

    /// <summary>bun on PATH (or where its installer puts it), else null: those tests then skip.</summary>
    public static string? Bun
    {
        get
        {
            var dirs = (Environment.GetEnvironmentVariable("PATH") ?? "").Split(Path.PathSeparator)
                .Append(Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.UserProfile), ".bun", "bin"));
            return dirs.Select(d => Path.Combine(d, OperatingSystem.IsWindows() ? "bun.exe" : "bun")).FirstOrDefault(File.Exists);
        }
    }

    public static string TempDir()
    {
        var d = Path.Combine(Path.GetTempPath(), "vs-win-tests-" + Guid.NewGuid().ToString("N")[..8]);
        Directory.CreateDirectory(d);
        return d;
    }

    /// <summary>A port nothing listens on.</summary>
    public static int FreePort()
    {
        var l = new TcpListener(IPAddress.Loopback, 0);
        l.Start();
        var port = ((IPEndPoint)l.LocalEndpoint).Port;
        l.Stop();
        return port;
    }

    public static Uri BaseFor(int port) => new($"http://127.0.0.1:{port}/");

    /// <summary>A launch of <paramref name="script"/> with bun on <paramref name="port"/>.</summary>
    public static Launch Launch(int port, string script, string dir, string name = "stub.ts", Dictionary<string, string>? env = null)
    {
        Skip.If(Bun is null, "bun isn't installed");
        var bun = Bun!;
        var file = Path.Combine(dir, name);
        File.WriteAllText(file, script);
        var vars = new Dictionary<string, string>
        {
            ["PORT"] = port.ToString(),
            ["SystemRoot"] = Environment.GetEnvironmentVariable("SystemRoot") ?? @"C:\Windows",
            ["USERPROFILE"] = Environment.GetEnvironmentVariable("USERPROFILE") ?? "",
            ["TEMP"] = Path.GetTempPath(),
        };
        foreach (var (k, v) in env ?? []) vars[k] = v;
        return new Launch(bun, [file], vars, Path.Combine(dir, "logs", "server.log"));
    }

    public static async Task<bool> Until(Func<bool> check, double seconds = 10)
    {
        var end = DateTime.UtcNow.AddSeconds(seconds);
        while (DateTime.UtcNow < end)
        {
            if (check()) return true;
            await Task.Delay(25);
        }
        return check();
    }

    /// <summary>An in-process HTTP server answering every request with <paramref name="handler"/>.</summary>
    public sealed class Stub : IDisposable
    {
        readonly HttpListener listener = new();
        public Uri Base { get; }
        public List<(string Method, string Path, string? Admin, string Body)> Requests { get; } = [];

        public Stub(Func<HttpListenerRequest, (int Status, string Body)> handler)
        {
            var port = FreePort();
            Base = BaseFor(port);
            listener.Prefixes.Add(Base.ToString());
            listener.Start();
            _ = Task.Run(async () =>
            {
                while (listener.IsListening)
                {
                    HttpListenerContext c;
                    try { c = await listener.GetContextAsync(); } catch { return; }
                    var body = new StreamReader(c.Request.InputStream).ReadToEnd();
                    lock (Requests) Requests.Add((c.Request.HttpMethod, c.Request.Url!.AbsolutePath, c.Request.Headers["x-viewswitcher-admin"], body));
                    var (status, text) = handler(c.Request);
                    var bytes = Encoding.UTF8.GetBytes(text);
                    c.Response.StatusCode = status;
                    c.Response.ContentType = "application/json";
                    await c.Response.OutputStream.WriteAsync(bytes);
                    c.Response.Close();
                }
            });
        }

        public static Stub Answering(string body, int status = 200) => new(_ => (status, body));

        public void Dispose()
        {
            listener.Stop();
            listener.Close();
        }
    }
}

