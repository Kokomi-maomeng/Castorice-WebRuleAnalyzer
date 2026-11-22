"""Linux window adapter. The shared frontend renders the title bar."""
import json
import signal
import sys
from urllib.parse import urlsplit

import gi

gi.require_version("Gdk", "3.0")
gi.require_version("Gtk", "3.0")
gi.require_version("WebKit2", "4.1")
from gi.repository import Gdk, Gio, GLib, Gtk, WebKit2


def main():
    config = json.load(sys.stdin)
    origin = config["url"]
    if not Gtk.init_check()[0]:
        raise RuntimeError("无法连接图形会话")

    window = Gtk.Window(title="Castorice-WebRuleAnalyzer")
    window.set_decorated(False)
    window.set_default_size(*config["size"])
    window.set_size_request(*config["minimum_size"])
    window.set_position(Gtk.WindowPosition.CENTER)
    window.connect("destroy", lambda *_: Gtk.main_quit())

    manager = WebKit2.UserContentManager()
    context = WebKit2.WebContext.new_ephemeral()
    view = WebKit2.WebView(web_context=context, user_content_manager=manager)
    window.add(view)
    view.show()
    last_press = None
    closing = False

    def reveal():
        if not closing and not window.get_visible():
            window.show()
        return GLib.SOURCE_REMOVE

    def edge_at(x, y):
        if window.is_maximized():
            return None
        left, right = x < 5, x >= view.get_allocated_width() - 5
        top, bottom = y < 5, y >= view.get_allocated_height() - 5
        if top:
            return (Gdk.WindowEdge.NORTH_WEST if left else
                    Gdk.WindowEdge.NORTH_EAST if right else Gdk.WindowEdge.NORTH)
        if bottom:
            return (Gdk.WindowEdge.SOUTH_WEST if left else
                    Gdk.WindowEdge.SOUTH_EAST if right else Gdk.WindowEdge.SOUTH)
        if left:
            return Gdk.WindowEdge.WEST
        if right:
            return Gdk.WindowEdge.EAST
        return None

    def press(_view, event):
        nonlocal last_press
        if event.button != 1:
            return False
        last_press = (
            event.get_device(), event.button,
            int(event.x_root), int(event.y_root), event.time,
        )
        edge = edge_at(event.x, event.y)
        if edge is None:
            return False
        window.get_window().begin_resize_drag_for_device(edge, *last_press)
        return True

    def motion(_view, event):
        edge = edge_at(event.x, event.y)
        name = ("".join(part[0] for part in edge.value_nick.split("-")) + "-resize"
                if edge is not None else None)
        event.window.set_cursor(Gdk.Cursor.new_from_name(event.window.get_display(), name) if name else None)
        return False

    def command(_manager, message):
        if not (view.get_uri() or "").startswith(origin + "/"):
            return
        action = message.get_js_value().to_string()
        if action == "ready":
            reveal()
        elif action == "minimize":
            window.iconify()
        elif action == "toggle-maximize":
            (window.unmaximize if window.is_maximized() else window.maximize)()
        elif action == "close":
            window.close()
        elif action == "move" and last_press is not None:
            window.get_window().begin_move_drag_for_device(*last_press)

    def window_state(_window, event):
        if event.changed_mask & Gdk.WindowState.MAXIMIZED:
            value = json.dumps(bool(event.new_window_state & Gdk.WindowState.MAXIMIZED))
            js = f"window.dispatchEvent(new CustomEvent('castorice-window-state', {{detail: {value}}}));"
            view.evaluate_javascript(js, -1, None, None, None, None, None)
        return False

    def navigation(_view, decision, kind):
        if kind not in (WebKit2.PolicyDecisionType.NAVIGATION_ACTION,
                        WebKit2.PolicyDecisionType.NEW_WINDOW_ACTION):
            return False
        action = decision.get_navigation_action()
        target = action.get_request().get_uri()
        if kind == WebKit2.PolicyDecisionType.NAVIGATION_ACTION and target.startswith(origin + "/"):
            return False
        decision.ignore()
        url = urlsplit(target)
        if (action.get_navigation_type() == WebKit2.NavigationType.LINK_CLICKED
                and url.scheme == "https" and url.hostname and url.username is None):
            try:
                Gio.AppInfo.launch_default_for_uri(target, None)
            except GLib.Error as error:
                print(error.message, file=sys.stderr)
        return True

    def close():
        window.close()
        return GLib.SOURCE_REMOVE

    def close_with_transition(_window, _event):
        nonlocal closing
        if closing:
            return True
        if not window.get_visible() or not window.get_settings().get_property("gtk-enable-animations"):
            return False
        closing = True
        duration = config["close_transition_ms"]
        if window.is_composited():
            started = GLib.get_monotonic_time()

            def fade():
                progress = (GLib.get_monotonic_time() - started) / (duration * 1000)
                if progress >= 1:
                    window.destroy()
                    return GLib.SOURCE_REMOVE
                window.set_opacity(1 - progress**2)
                return GLib.SOURCE_CONTINUE

            GLib.timeout_add(16, fade)
        else:
            view.evaluate_javascript(config["closing_event"], -1, None, None, None, None, None)
            GLib.timeout_add(duration, window.destroy)
        return True

    manager.connect("script-message-received::castoriceWindow", command)
    manager.register_script_message_handler("castoriceWindow")
    manager.add_script(WebKit2.UserScript.new(
        config["init"], WebKit2.UserContentInjectedFrames.TOP_FRAME,
        WebKit2.UserScriptInjectionTime.START, None, None,
    ))
    view.connect("decide-policy", navigation)
    view.connect("button-press-event", press)
    view.connect("motion-notify-event", motion)
    window.connect("window-state-event", window_state)
    window.connect("delete-event", close_with_transition)
    view.connect("web-process-terminated", lambda *_: close())
    GLib.unix_signal_add(GLib.PRIORITY_DEFAULT, signal.SIGTERM, close)
    view.load_uri(origin + "/")
    GLib.timeout_add_seconds(5, reveal)
    Gtk.main()


if __name__ == "__main__":
    main()
