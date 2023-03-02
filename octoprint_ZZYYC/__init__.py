# from __future__ import absolute_import

import octoprint.plugin

class HelloWorldPlugin(octoprint.plugin.StartupPlugin,
                       octoprint.plugin.TemplatePlugin,
                       octoprint.plugin.SettingsPlugin,
                       octoprint.plugin.AssetPlugin):

    # def on_after_startup(self):
    #     self._logger.info("Hello World!")

    # def get_settings_defaults(self):
    #     return dict(text="Milling")

    def get_template_configs(self):
        return [
                dict(type="settings", custom_bindings=False),
                #dict(type="tab",  custom_bindings=False,)# replaces="temperature",)
                ]

    def get_assets(self):
        return dict(js=["js/ZZYYC.js"])

__plugin_name__ = "Probing"
__plugin_pythoncompat__ = ">=3.7,<4"
__plugin_implementation__ = HelloWorldPlugin()