import Adw from 'gi://Adw';
import GObject from 'gi://GObject';
import Gtk from 'gi://Gtk';

import { ICONS } from '../constants.js';

export const GeneralPage = GObject.registerClass(
  class GeneralPage extends Adw.PreferencesPage {
    constructor(settings) {
      super({
        title: 'Settings',
        icon_name: 'preferences-system-symbolic',
        name: 'GeneralPage',
      });

      this._settings = settings;

      const tweaksGroup = new Adw.PreferencesGroup({
        title: 'Tweaks',
      });

      const iconsList = new Gtk.StringList();
      ICONS.forEach((icon) => iconsList.append(icon.title));

      const iconSelectorRow = new Adw.ComboRow({
        title: 'Menu Icon',
        subtitle: 'Change the menu icon',
        model: iconsList,
        selected: this._settings.get_int('icon'),
      });

      const activityMenuSwitch = new Gtk.Switch({
        valign: Gtk.Align.CENTER,
        active: !this._settings.get_boolean('activity-menu-visibility'),
      });

      const activityMenuRow = new Adw.ActionRow({
        title: 'Hide Activities Menu',
        subtitle: 'Toggle to hide the Activities menu button',
        activatable_widget: activityMenuSwitch,
      });
      activityMenuRow.add_suffix(activityMenuSwitch);

      tweaksGroup.add(iconSelectorRow);
      tweaksGroup.add(activityMenuRow);

      this.add(tweaksGroup);

      iconSelectorRow.connect('notify::selected', (widget) => {
        this._settings.set_int('icon', widget.selected);
      });

      activityMenuSwitch.connect('notify::active', (widget) => {
        this._settings.set_boolean('activity-menu-visibility', !widget.get_active());
      });
    }
  }
);
