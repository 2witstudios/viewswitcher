using System.Text.RegularExpressions;

namespace ViewSwitcher.Core;

/// <summary>What the tray icon shows: the on-air view, OBS and the USB-C link, from the live state (Kit's MenuStatus).</summary>
public sealed record MenuStatus(string Title, bool Live, string OnAir, string Obs, string Ipad, bool ObsReady)
{
    public const int TitleMax = 24;

    public static string Short(string s)
    {
        var chars = s.EnumerateRunes().ToArray();
        if (chars.Length <= TitleMax) return s;
        var cut = string.Concat(chars.Take(TitleMax - 1).Select(r => r.ToString()));
        return Regex.Replace(cut, @"\s+$", "") + "…";
    }

    /// <summary><paramref name="state"/> is null while the server doesn't answer.</summary>
    public static MenuStatus From(LiveState? state)
    {
        if (state is null) return new("", false, "Server not responding", "OBS: unknown", "iPad: unknown", false);
        var label = state.OnAir?.Label ?? "";
        var setup = state.ObsSetup;
        var needsSetup = state.Obs.Connected && setup is not null && !setup.Ready;

        var obs = state.Obs.Auth == "missing" ? "OBS: needs a password" : state.Obs.Auth == "wrong" ? "OBS: refused the password" : "OBS: not connected";
        if (state.Obs.Connected)
        {
            if (needsSetup) obs = "OBS: needs setup";
            else if (setup is not null && setup.Missing.Count > 0) obs = $"OBS: connected · add {string.Join(", ", setup.Missing)}";
            else obs = "OBS: connected";
            var outputs = new[] { state.Obs.Streaming ? "live" : null, state.Obs.Recording ? "recording" : null }.Where(o => o is not null).ToArray();
            if (outputs.Length > 0) obs += $" · {string.Join(", ", outputs)}";
        }

        string ipad;
        if (state.Usb is { Enabled: true } usb)
        {
            var device = usb.Device ?? "iPad"; // an iPhone is named as one
            ipad = usb.Connected ? $"{device}: connected over USB" : usb.Attached ? $"{device}: plugged in · open ViewSwitcher on it" : "iPhone or iPad: not plugged in";
        }
        else
        {
            ipad = "iPhone or iPad: USB link off";
        }

        return new(
            label.Length == 0 ? "" : Short(label),
            state.OnAir is not null,
            label.Length == 0 ? "Nothing on air" : $"On air: {label}",
            obs,
            ipad,
            state.Obs.Connected && setup is not null && !needsSetup);
    }
}
