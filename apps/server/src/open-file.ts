// "Open in editor" on this computer: the command that opens a library file in a text editor. Always an
// argument list, never a shell string, so a file name can't become a command.

/** VIEWSWITCHER_EDITOR (an app name on macOS, an executable on Windows), else the system's text editor. */
export function editorCommand(abs: string, editor: string | undefined = process.env.VIEWSWITCHER_EDITOR, platform: NodeJS.Platform = process.platform): string[] {
  if (platform === "win32") return [editor || "notepad.exe", abs];
  return editor ? ["open", "-a", editor, abs] : ["open", "-t", abs];
}
