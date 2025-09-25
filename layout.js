export const LAYOUT = Object.freeze([
  {
    type: "menu",
    title: "About This PC",
    cmds: ["gnome-control-center", "about"],
  },
  {
    type: "separator",
  },
  {
    type: "menu",
    title: "System Settings...",
    cmds: ["gnome-control-center"],
  },
  {
    type: "menu",
    title: "App Store...",
    cmds: ["gnome-software"],
  },
  {
    type: "separator",
  },
  {
    type: "expandable-menu",
    title: "Recent Items",
  },
  {
    type: "separator",
  },
  {
    type: "menu",
    title: "Force Quit",
    cmds: ["xkill"],
  },
  {
    type: "separator",
  },
  {
    type: "menu",
    title: "Sleep",
    cmds: ["systemctl", "suspend"],
  },
  {
    type: "menu",
    title: "Restart...",
    cmds: ["gnome-session-quit", "--reboot"],
  },
  {
    type: "menu",
    title: "Shut Down...",
    cmds: ["gnome-session-quit", "--power-off"],
  },
  {
    type: "separator",
  },
  {
    type: "menu",
    title: "Lock Screen",
    cmds: ["loginctl", "lock-session"],
  },
  {
    type: "menu",
    title: "Log Out...",
    cmds: ["gnome-session-quit", "--logout"],
  },
].map((item) => Object.freeze(item)));
