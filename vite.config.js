import { defineConfig } from 'vite'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const projectRoot = dirname(fileURLToPath(import.meta.url))

export default defineConfig({
  build: {
    rollupOptions: {
      input: {
        index: resolve(projectRoot, 'index.html'),
        login: resolve(projectRoot, 'login.html'),
        register: resolve(projectRoot, 'register.html'),
        main: resolve(projectRoot, 'main.html'),
        battle: resolve(projectRoot, 'battle.html'),
      },
    },
  },
})
