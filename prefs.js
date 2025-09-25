import { ExtensionPreferences } from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';
import { GeneralPage } from './preferences/generalPage.js';

export default class MaccyMenuPreferences extends ExtensionPreferences {
  fillPreferencesWindow(window) {
    const settings = this.getSettings();

    const generalPage = new GeneralPage(settings);

    const prefsWidth = settings.get_int('prefs-default-width');
    const prefsHeight = settings.get_int('prefs-default-height');

    window.set_default_size(prefsWidth, prefsHeight);
    window.set_search_enabled(true);

    window.add(generalPage);

    window.connect('close-request', () => {
      const { default_width: currentWidth, default_height: currentHeight } = window;

      if (currentWidth !== prefsWidth || currentHeight !== prefsHeight) {
        settings.set_int('prefs-default-width', currentWidth);
        settings.set_int('prefs-default-height', currentHeight);
      }

      window.destroy();
    });
  }
}
