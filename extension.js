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
      const submenuItem = new PopupMenu.PopupSubMenuMenuItem(title);
      submenuItem.menu.actor.add_style_class_name('maccymenu-recent-menu');

      const populateMenu = () => {
        submenuItem.menu.removeAll();

        const recentItems = this._getRecentItems();
        if (recentItems.length === 0) {
          const placeholder = new PopupMenu.PopupMenuItem('No recent items');
          placeholder.setSensitive(false);
          submenuItem.menu.addMenuItem(placeholder);
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
          });
          submenuItem.menu.addMenuItem(recentMenuItem);
        });
      };

      let hoverCloseTimeout = 0;
      const cancelClose = () => {
        if (hoverCloseTimeout) {
          GLib.source_remove(hoverCloseTimeout);
          hoverCloseTimeout = 0;
        }
      };

      const closeLater = () => {
        cancelClose();
        hoverCloseTimeout = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 300, () => {
          submenuItem.setSubmenuShown(false);
          return GLib.SOURCE_REMOVE;
        });
      };

      const mainMenuCloseId = this.menu.connect('open-state-changed', (_, open) => {
        if (!open) {
          cancelClose();
          submenuItem.setSubmenuShown(false);
        }
      });

      const submenuOpenId = submenuItem.menu.connect('open-state-changed', (_menu, isOpen) => {
        if (isOpen) {
          cancelClose();
          populateMenu();
        }
      });

      submenuItem.actor.connect('enter-event', () => {
        cancelClose();
        populateMenu();
        submenuItem.setSubmenuShown(true);
        return Clutter.EVENT_PROPAGATE;
      });

      submenuItem.actor.connect('leave-event', () => {
        closeLater();
        return Clutter.EVENT_PROPAGATE;
      });

      submenuItem.menu.actor.connect('enter-event', () => {
        cancelClose();
        return Clutter.EVENT_PROPAGATE;
      });

      submenuItem.menu.actor.connect('leave-event', () => {
        closeLater();
        return Clutter.EVENT_PROPAGATE;
      });

      submenuItem.connect('destroy', () => {
        cancelClose();
        if (mainMenuCloseId) {
          this.menu.disconnect(mainMenuCloseId);
        }
        if (submenuOpenId) {
          submenuItem.menu.disconnect(submenuOpenId);
        }
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
