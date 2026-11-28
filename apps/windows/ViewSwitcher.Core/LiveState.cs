using System.Text.Json;
using System.Text.Json.Serialization;

namespace ViewSwitcher.Core;

// The parts of the server's LiveState (packages/shared/src/types.ts) the Windows app reads; Kit's
// LiveState.swift. Decoding is lenient: a field the server adds later never breaks the tray.

public sealed record OnAir(string Label);

public sealed record ObsStatus(bool Connected, bool Recording = false, bool Streaming = false, string? Auth = null);

public sealed record ObsSetup(bool Scene, bool Program, bool Ground, bool? Ordered = true, IReadOnlyList<string>? MissingDevices = null)
{
    /// <summary>packages/shared obsReady: the scene and both of the switcher's own sources exist, in order.</summary>
    [JsonIgnore] public bool Ready => Scene && Program && Ground && Ordered != false;
    [JsonIgnore] public IReadOnlyList<string> Missing => MissingDevices ?? [];
}

public sealed record UsbStatus(bool Enabled, bool Attached = false, bool Connected = false, string? Device = null);

public sealed record LiveState(OnAir? OnAir, ObsStatus Obs, ObsSetup? ObsSetup = null, UsbStatus? Usb = null)
{
    /// <summary>OBS is streaming or recording: Set Up OBS asks first.</summary>
    [JsonIgnore] public bool ObsLive => Obs.Streaming || Obs.Recording;
}

public static class Json
{
    public static readonly JsonSerializerOptions Options = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        PropertyNameCaseInsensitive = true,
        DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull,
    };
}

/// <summary>A /ws message: only {"t":"state"} matters to the shell.</summary>
public static class ServerMessage
{
    public static LiveState? State(string json)
    {
        try
        {
            using var doc = JsonDocument.Parse(json);
            var root = doc.RootElement;
            if (root.ValueKind != JsonValueKind.Object || !root.TryGetProperty("t", out var t) || t.GetString() != "state") return null;
            if (!root.TryGetProperty("state", out var s) || s.ValueKind != JsonValueKind.Object) return null;
            var state = s.Deserialize<LiveState>(Json.Options);
            return state?.Obs is null ? null : state;
        }
        catch (JsonException)
        {
            return null;
        }
    }
}
