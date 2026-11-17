interface CastoriceDesktop {
  version: string;
  dataDir: string;
  exportDir: string;
}
interface Window {
  castoriceDesktop?: CastoriceDesktop;
  castoriceWindow?: {
    maximized: boolean;
    command: (
      action: "move" | "minimize" | "toggle-maximize" | "close",
    ) => void;
  };
}
