import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import St from 'gi://St';
import Clutter from 'gi://Clutter';

import { Extension } from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import * as Util from 'resource:///org/gnome/shell/misc/util.js';

import { ICONS } from './constants.js';
import { LAYOUT } from './layout.js';

const MAX_RECENT_ITEMS = 10;
const RECENT_ITEMS_FILE = GLib.build_filenamev([
  GLib.get_user_data_dir(),
  'recently-used.xbel',
]);
const HOVER_CLOSE_DELAY_MS = 200;
const EXTERNAL_MENU_GAP_PX = 16;

const MaccyMenu = GObject.registerClass(
  class MaccyMenu extends PanelMenu.Button {
    _init(settings, extensionPath) {
      super._init(0.0, 'MaccyMenu');

      this._settings = settings;
      this._extensionPath = extensionPath;
      this._settingsSignalIds = [];
      this._menuOpenSignalId = 0;

      this._icon = new St.Icon({
        style_class: 'menu-button',
      });
      this.add_child(this._icon);

      this._settingsSignalIds.push(
        this._settings.connect('changed::icon', () => this._setIcon())
      );
      this._settingsSignalIds.push(
        this._settings.connect('changed::activity-menu-visibility', () =>
          this._syncActivitiesVisibility()
        )
      );

      this._menuOpenSignalId = this.menu.connect(
        'open-state-changed',
        (_, isOpen) => {
          if (isOpen) {
            this._renderPopupMenu();
          }
        }
      );

      this._setIcon();
      this._syncActivitiesVisibility();
      this._renderPopupMenu();
    }

    destroy() {
      this._settingsSignalIds.forEach((id) => this._settings.disconnect(id));
      this._settingsSignalIds = [];

      if (this._menuOpenSignalId !== 0) {
        this.menu.disconnect(this._menuOpenSignalId);
        this._menuOpenSignalId = 0;
      }

      this._showActivitiesButton();

      this._settings = null;

      super.destroy();
    }

    _setIcon() {
      const iconIndex = this._settings.get_int('icon');
      const iconInfo = ICONS[iconIndex] ?? ICONS[0];
      const iconPath = `${this._extensionPath}${iconInfo.path}`;

      this._icon.gicon = Gio.icon_new_for_string(iconPath);
    }

    _syncActivitiesVisibility() {
      const container = this._getActivitiesContainer();
      if (!container) {
        return;
      }

      const shouldShow = this._settings.get_boolean('activity-menu-visibility');
      if (shouldShow) {
        container.show();
      } else {
        container.hide();
      }
    }

    _showActivitiesButton() {
      const container = this._getActivitiesContainer();
      if (container) {
        container.show();
      }
    }

    _getActivitiesContainer() {
      const statusArea = Main.panel?.statusArea;
      if (!statusArea) {
        return null;
      }

      const activitiesEntry =
        statusArea.activities ??
        statusArea.activitiesButton ??
        statusArea['activities'];

      if (!activitiesEntry) {
        return null;
      }

      return activitiesEntry.container ?? activitiesEntry;
    }

    _renderPopupMenu() {
      this.menu.removeAll();

      const layout = this._generateLayout();
      layout.forEach((item) => {
        switch (item.type) {
          case 'menu':
            this._makeMenu(item.title, item.cmds);
            break;
          case 'expandable-menu':
            this._makeExpandableMenu(item.title);
            break;
          case 'separator':
            this._makeSeparator();
            break;
        }
      });
    }

    _generateLayout() {
      const fullName = GLib.get_real_name() || GLib.get_user_name() || '';

      return LAYOUT.map((item) => {
        if (item.type === 'menu' && item.cmds?.includes('--logout')) {
          const title = fullName
            ? `Log Out ${fullName}...`
            : item.title;
          return {
            ...item,
            title,
            cmds: item.cmds ? [...item.cmds] : undefined,
          };
        }

        return {
          ...item,
          cmds: item.cmds ? [...item.cmds] : undefined,
        };
      });
    }

    _makeMenu(title, cmds) {
      const menuItem = new PopupMenu.PopupMenuItem(title);
      menuItem.connect('activate', () => Util.spawn(cmds));
      this.menu.addMenuItem(menuItem);
    }

    _makeExpandableMenu(title) {
      const submenuItem = new PopupMenu.PopupBaseMenuItem({
        reactive: true,
        can_focus: true,
        hover: true,
      });

      const label = new St.Label({
        text: title,
        x_expand: true,
        y_align: Clutter.ActorAlign.CENTER,
      });
      submenuItem.add_child(label);

      const arrowIcon = new St.Icon({
        icon_name: 'go-next-symbolic',
        style_class: 'popup-menu-arrow',
        y_align: Clutter.ActorAlign.CENTER,
      });
      submenuItem.add_child(arrowIcon);

      let externalMenu = null;
      let externalMenuSignalIds = [];
      let hoverCloseTimeoutId = 0;
      let mainMenuCloseId = 0;
      let submenuDestroyId = 0;
      let chromeAdded = false;

      const populateMenu = (menu) => {
        menu.removeAll();

        const recentItems = this._getRecentItems();
        if (recentItems.length === 0) {
          const placeholder = new PopupMenu.PopupMenuItem('No recent items');
          placeholder.setSensitive(false);
          menu.addMenuItem(placeholder);
          return;
        }

        recentItems.forEach(({ title: itemTitle, uri }) => {
          const recentMenuItem = new PopupMenu.PopupMenuItem(itemTitle);
          recentMenuItem.connect('activate', () => {
            try {
              const context = global.create_app_launch_context(0, -1);
              Gio.AppInfo.launch_default_for_uri(uri, context);
            } catch (error) {
              logError(error, `Failed to open recent item: ${uri}`);
            }
            this.menu.close(true);
            closeAndDestroyMenu();
          });
          menu.addMenuItem(recentMenuItem);
        });
      };

      const cancelClose = () => {
        if (hoverCloseTimeoutId) {
          GLib.source_remove(hoverCloseTimeoutId);
          hoverCloseTimeoutId = 0;
        }
      };

      const scheduleClose = () => {
        cancelClose();
        hoverCloseTimeoutId = GLib.timeout_add(
          GLib.PRIORITY_DEFAULT,
          HOVER_CLOSE_DELAY_MS,
          () => {
            closeAndDestroyMenu();
            return GLib.SOURCE_REMOVE;
          }
        );
      };

      const disconnectExternalMenuSignals = () => {
        if (!externalMenu) {
          return;
        }

        externalMenuSignalIds.forEach((id) => {
          if (id) {
            try {
              externalMenu.actor.disconnect(id);
            } catch (_error) {
              // Ignore, signal already disconnected during teardown
            }
          }
        });
        externalMenuSignalIds = [];
      };

      const ensureExternalMenu = () => {
        if (externalMenu) {
          populateMenu(externalMenu);
          return externalMenu;
        }

        externalMenu = new PopupMenu.PopupMenu(submenuItem.actor, 0.0, St.Side.RIGHT);
        externalMenu.setArrowOrigin(0.0);
        externalMenu.actor.add_style_class_name('maccy-external-menu');
        if (externalMenu.actor.set_margin_left) {
          externalMenu.actor.set_margin_left(EXTERNAL_MENU_GAP_PX);
        } else {
          externalMenu.actor.style = `margin-left: ${EXTERNAL_MENU_GAP_PX}px;`;
        }
        externalMenu.actor.translation_x = EXTERNAL_MENU_GAP_PX;
        externalMenu.actor.track_hover = true;
        externalMenu.actor.reactive = true;

        Main.layoutManager.addTopChrome(externalMenu.actor);
        chromeAdded = true;

        populateMenu(externalMenu);

        externalMenuSignalIds.push(
          externalMenu.actor.connect('enter-event', () => {
            cancelClose();
            return Clutter.EVENT_PROPAGATE;
          })
        );
        externalMenuSignalIds.push(
          externalMenu.actor.connect('leave-event', () => {
            scheduleClose();
            return Clutter.EVENT_PROPAGATE;
          })
        );

        if (mainMenuCloseId === 0) {
          mainMenuCloseId = this.menu.connect('open-state-changed', (_, open) => {
            if (!open) {
              closeAndDestroyMenu();
            }
          });
        }

        if (submenuDestroyId === 0) {
          submenuDestroyId = submenuItem.connect('destroy', () => {
            closeAndDestroyMenu();
          });
        }

        return externalMenu;
      };

      const closeAndDestroyMenu = () => {
        cancelClose();

        if (mainMenuCloseId !== 0) {
          this.menu.disconnect(mainMenuCloseId);
          mainMenuCloseId = 0;
        }

        if (submenuDestroyId !== 0) {
          try {
            submenuItem.disconnect(submenuDestroyId);
          } catch (_error) {
            // Signal was already disconnected, ignore
          }
          submenuDestroyId = 0;
        }

        if (externalMenu) {
          disconnectExternalMenuSignals();
          externalMenu.close(true);
          if (chromeAdded) {
            Main.layoutManager.removeChrome(externalMenu.actor);
            chromeAdded = false;
          }
          externalMenu.destroy();
          externalMenu = null;
        }
      };

      submenuItem.actor.connect('enter-event', () => {
        cancelClose();
        const menu = ensureExternalMenu();
        menu.open(true);
        return Clutter.EVENT_PROPAGATE;
      });

      submenuItem.actor.connect('leave-event', () => {
        scheduleClose();
        return Clutter.EVENT_PROPAGATE;
      });

      submenuItem.actor.connect('button-press-event', () => {
        cancelClose();
        const menu = ensureExternalMenu();
        menu.open(true);
        return Clutter.EVENT_STOP;
      });

      submenuItem.connect('activate', () => {
        cancelClose();
        const menu = ensureExternalMenu();
        menu.open(true);
      });

      this.menu.addMenuItem(submenuItem);
    }

    _makeSeparator() {
      const separator = new PopupMenu.PopupSeparatorMenuItem();
      this.menu.addMenuItem(separator);
    }

    _getRecentItems() {
      const file = Gio.File.new_for_path(RECENT_ITEMS_FILE);
      if (!file.query_exists(null)) {
        return [];
      }

      let contents;
      try {
        [, contents] = file.load_contents(null);
      } catch (error) {
        logError(error, 'Failed to read recent items list');
        return [];
      }

      const text = new TextDecoder().decode(contents);
      const regex = /<bookmark[^>]*href="([^"]+)"[^>]*modified="([^"]+)"[^>]*>([\s\S]*?<title>([^<]*)<\/title>)?/g;
      const items = [];
      const seenUris = new Set();

      let match;
      while ((match = regex.exec(text)) !== null) {
        const uri = match[1];
        const modified = match[2];
        const titleMarkup = match[4] ?? '';

        if (seenUris.has(uri)) {
          continue;
        }
        seenUris.add(uri);

        let timestamp = 0;
        try {
          const dateTime = GLib.DateTime.new_from_iso8601(modified, null);
          if (dateTime) {
            timestamp = dateTime.to_unix();
          }
        } catch (error) {
          logError(error, `Failed to parse modified time for ${uri}`);
        }

        let title = titleMarkup.trim();
        if (!title) {
          const decodedUri = GLib.uri_unescape_string(uri, null) ?? uri;
          if (decodedUri.startsWith('file://')) {
            const filePath = decodedUri.substring('file://'.length);
            title = GLib.path_get_basename(filePath);
          } else {
            title = decodedUri;
          }
        }

        items.push({
          title,
          uri,
          timestamp,
        });
      }

      items.sort((a, b) => b.timestamp - a.timestamp);

      return items.slice(0, MAX_RECENT_ITEMS);
    }
  }
);

export default class MaccyMenuExtension extends Extension {
  enable() {
    this._settings = this.getSettings();
    this._indicator = new MaccyMenu(this._settings, this.path);
    Main.panel.addToStatusArea('maccyMenuButton', this._indicator, 0, 'left');
  }

  disable() {
    if (this._indicator) {
      this._indicator.destroy();
      this._indicator = null;
    }

    this._settings = null;
  }
}
