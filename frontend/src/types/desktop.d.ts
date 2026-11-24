interface CastoriceDesktop {
  version: string;
  dataDir: string;
  exportDir: string;
}
interface Window {
  castoriceDesktop?: CastoriceDesktop;
  castoriceWindow?: {
    maximized: boolean;
    systemDark?: boolean;
    command: (
      action: "ready" | "move" | "minimize" | "toggle-maximize" | "close",
    ) => void;
  };
}
