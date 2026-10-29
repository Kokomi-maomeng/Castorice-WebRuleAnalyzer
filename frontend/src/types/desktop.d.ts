interface CastoriceDesktop {
  version: string;
  dataDir: string;
  exportDir: string;
}
interface Window {
  castoriceDesktop?: CastoriceDesktop;
}
