import type { ScanOptions } from "../types";
import { modeNames } from "../utils/format";
import SegmentedControl from "./SegmentedControl";

type Mode = ScanOptions["mode"];
export const controlledBrowserHelp =
  "快速和深度模式下，开启会显示独立的采集浏览器窗口，关闭则在后台运行。自行交互始终显示窗口，供你手动操作。每次采集使用独立的临时浏览器资料";

export const scanModeDescriptions: Record<Mode, string> = {
  quick: "加载一个页面，短暂观察它发出的网络请求，随后自动结束",
  explore: "从起始页自动访问同源链接，按深度和页数限制采集，不提交表单",
  interactive:
    "打开受控浏览器，由你在当前标签页操作。可以暂停和继续记录，到达上限时自动结束",
};

export default function ScanModeSelect({
  value,
  onChange,
  disabled,
  canShowBrowser,
}: {
  value: Mode;
  onChange: (value: Mode) => void;
  disabled: boolean;
  canShowBrowser: boolean;
}) {
  return (
    <SegmentedControl
      label="扫描模式"
      className="scan-mode"
      value={value}
      onChange={onChange}
      disabled={disabled}
      options={(Object.keys(scanModeDescriptions) as Mode[]).map((mode) => ({
        value: mode,
        label: modeNames[mode],
        hint:
          mode === "interactive" && !canShowBrowser
            ? "自行交互需要服务端图形会话"
            : scanModeDescriptions[mode],
        disabled: mode === "interactive" && !canShowBrowser,
      }))}
    />
  );
}
