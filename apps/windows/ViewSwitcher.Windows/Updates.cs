using Velopack;
using Velopack.Sources;

namespace ViewSwitcher.Windows;

/// <summary>
/// Updates from GitHub Releases through Velopack (the Mac's Sparkle): checked at launch and every 6 hours,
/// downloaded in the background, and applied when the person says so (never in the middle of a show
/// without asking). Only an installed app has it: not a development build, the e2e run, or with
/// VIEWSWITCHER_UPDATES=0.
/// </summary>
public sealed class Updates
{
    public const string Repo = "https://github.com/2witstudios/viewswitcher";
    readonly UpdateManager manager;
    readonly System.Threading.Timer timer;
    UpdateInfo? ready;
    bool checking;

    public bool Available => true;

    Updates(UpdateManager manager)
    {
        this.manager = manager;
        var ui = Microsoft.UI.Dispatching.DispatcherQueue.GetForCurrentThread();
        timer = new System.Threading.Timer(_ => ui.TryEnqueue(() => Check(interactive: false)), null, TimeSpan.FromSeconds(30), TimeSpan.FromHours(6));
    }

    public static Updates? Start()
    {
        if (!Env.UpdatesEnabled || Env.E2E || Env.Dev) return null;
        try
        {
            var m = new UpdateManager(new GithubSource(Repo, null, false));
            return m.IsInstalled ? new Updates(m) : null;
        }
        catch (Exception)
        {
            return null;
        }
    }


    public async void Check(bool interactive)
    {
        if (checking) return;
        checking = true;
        try
        {
            ready ??= await manager.CheckForUpdatesAsync();
            if (ready is null)
            {
                if (interactive) Outside.Alert("ViewSwitcher is up to date", $"You have the latest version ({Env.Version}).", Outside.Icon.Info);
                return;
            }
            await manager.DownloadUpdatesAsync(ready);
            var version = ready.TargetFullRelease.Version.ToString();
            var now = Outside.Alert("A new ViewSwitcher is ready", $"Version {version} is downloaded. Restart ViewSwitcher now to use it? The server stops for a few seconds, so OBS and phones lose the switcher until it's back. Choose Cancel to update the next time ViewSwitcher starts.", Outside.Icon.Info, okCancel: true);
            if (now)
            {
                var own = App.Current.Supervisor.Quit();
                if (own is not null) await own.StopAsync();
                manager.ApplyUpdatesAndRestart(ready);
            }
            else
            {
                manager.WaitExitThenApplyUpdates(ready, silent: true, restart: false);
            }
        }
        catch (Exception e)
        {
            if (interactive) Outside.Alert("Couldn't check for updates", e.Message);
        }
        finally
        {
            checking = false;
        }
    }
}
