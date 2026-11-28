namespace ViewSwitcher.Core;

// Phones and tablets on the Wi-Fi: what the server's /api/remote says, and how the app shows it (Kit's
// Remotes.swift). The server keeps the codes and tokens (apps/server/src/pairing.ts); the app only shows
// a code, its QR code, and the paired devices.

public sealed record RemoteDevice(string Id, string Name, double PairedAt, double LastSeen, int Connected);

/// <summary><see cref="Code"/> is only in the answer that made it: the server never sends a code again.</summary>
public sealed record PairingCode(string? Code, double ExpiresAt);

public sealed record RemoteStatus(bool Enabled, int Port, string? LocalName, IReadOnlyList<string> Urls, PairingCode? Code, bool? CodeGuessed, IReadOnlyList<RemoteDevice> Devices, string? PairUrl = null);

public static class RemoteText
{
    /// <summary>The setting's help text: plain HTTP on the Wi-Fi is the known limit (the Decisions page).</summary>
    public const string Help = "Phones and tablets you pair can switch views from a browser. Wi-Fi traffic isn't encrypted, so use this on networks you trust, like home or church Wi-Fi.";

    public const string Guessed = "That code was cancelled after too many wrong tries. Someone on this network may be guessing; make a new code when your phone or tablet is ready.";

    /// <summary>What Windows needs for phones to reach this PC: the firewall rule, and the Wi-Fi marked private.</summary>
    public const string WindowsNetwork = "Phones reach this PC over the Wi-Fi. Windows lets them in on a private network: in Settings → Network & internet → Wi-Fi, set this network to Private, and choose Allow if Windows Firewall asks about ViewSwitcher.";

    /// <summary>"K7PQ2MXA" → "K7PQ-2MXA", easier to read out and type.</summary>
    public static string Code(string c) => c.Length == 8 ? $"{c[..4]}-{c[4..]}" : c;

    /// <summary>"Expires in 4:59", "Expired".</summary>
    public static string Expiry(double expiresAt, DateTimeOffset? now = null)
    {
        var at = (now ?? DateTimeOffset.UtcNow).ToUnixTimeMilliseconds() / 1000.0;
        // Never more than the 5 minutes a code lives (the two clocks round differently).
        var left = Math.Min(300, (int)Math.Ceiling(expiresAt / 1000 - at));
        return left <= 0 ? "Expired" : $"Expires in {left / 60}:{left % 60:00}";
    }

    /// <summary>"Connected now", "Seen 3 min ago", "Seen 2 days ago".</summary>
    public static string LastSeen(RemoteDevice d, DateTimeOffset? now = null)
    {
        if (d.Connected > 0) return "Connected now";
        var s = Math.Max(0, (int)((now ?? DateTimeOffset.UtcNow).ToUnixTimeMilliseconds() / 1000.0 - d.LastSeen / 1000));
        if (s < 60) return "Seen just now";
        if (s < 3600) return $"Seen {s / 60} min ago";
        if (s < 86400) return $"Seen {s / 3600} h ago";
        var days = s / 86400;
        return $"Seen {days} day{(days == 1 ? "" : "s")} ago";
    }
}
