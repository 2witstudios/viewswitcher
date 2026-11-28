using System.Net.WebSockets;
using System.Text;

namespace ViewSwitcher.Core;

/// <summary>
/// The tray follows the live state over the server's WebSocket, like any switcher page (Kit's LiveClient):
/// every {"t":"state"} arrives through <see cref="State"/>, a dropped connection through <see cref="Closed"/>
/// (with a null state first), and it connects again every 2 s until stopped. Events are raised on the
/// context it was started on.
/// </summary>
public sealed class LiveClient(Uri baseUri)
{
    readonly Uri url = new UriBuilder(baseUri) { Scheme = "ws", Path = "/ws" }.Uri;
    CancellationTokenSource? cts;
    SynchronizationContext? context;

    public event Action<LiveState?>? State;
    public event Action? Closed;

    public void Start()
    {
        Stop();
        context = SynchronizationContext.Current;
        cts = new CancellationTokenSource();
        _ = Run(cts.Token);
    }

    public void Stop()
    {
        cts?.Cancel();
        cts = null;
    }

    void Raise(Action a)
    {
        if (context is null) a();
        else context.Post(_ => a(), null);
    }

    async Task Run(CancellationToken ct)
    {
        while (!ct.IsCancellationRequested)
        {
            using (var ws = new ClientWebSocket())
            {
                ws.Options.Proxy = null;
                try
                {
                    await ws.ConnectAsync(url, ct);
                    await Receive(ws, ct);
                }
                catch (Exception) when (!ct.IsCancellationRequested) { }
                catch (Exception) { return; }
            }
            if (ct.IsCancellationRequested) return;
            Raise(() => { State?.Invoke(null); Closed?.Invoke(); });
            try
            {
                await Task.Delay(2000, ct);
            }
            catch (OperationCanceledException)
            {
                return;
            }
        }
    }

    async Task Receive(ClientWebSocket ws, CancellationToken ct)
    {
        var buffer = new byte[64 * 1024];
        var message = new MemoryStream();
        while (ws.State == WebSocketState.Open && !ct.IsCancellationRequested)
        {
            var r = await ws.ReceiveAsync(buffer, ct);
            if (r.MessageType == WebSocketMessageType.Close) return;
            message.Write(buffer, 0, r.Count);
            if (!r.EndOfMessage) continue;
            var text = Encoding.UTF8.GetString(message.GetBuffer(), 0, (int)message.Length);
            message.SetLength(0);
            if (ServerMessage.State(text) is { } state) Raise(() => State?.Invoke(state));
        }
    }
}
