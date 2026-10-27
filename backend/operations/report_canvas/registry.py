class Registry(dict):
    def register(self, name, plugin):
        if name in self:
            raise ValueError("Duplicate plugin: " + name)
        self[name] = plugin
        return plugin

SOURCES = Registry()
BLOCKS = Registry()
EXPORTERS = Registry()
