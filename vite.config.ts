import { resolve } from 'path';
import { defineConfig, type Plugin } from 'vite';

// Vite hot-reloads src/ already; also full-reload the page when a model in
// public/ is re-exported from Blender.
function reloadOnAssets(): Plugin {
  return {
    name: 'reload-on-assets',
    configureServer(server) {
      server.watcher.add(['public/models']);
      server.watcher.on('change', (file) => {
        if (/\.(glb|gltf)$/.test(file)) {
          server.ws.send({ type: 'full-reload' });
        }
      });
    },
  };
}

export default defineConfig({
  base: '/game-airplane/',
  plugins: [reloadOnAssets()],
  server: { host: true, port: 5180 },
  build: {
    rollupOptions: {
      input: { main: resolve(import.meta.dirname, 'index.html'), ohare: resolve(import.meta.dirname, 'ohare.html') },
    },
  },
});
