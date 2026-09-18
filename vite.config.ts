import { defineConfig } from 'vite'

export default defineConfig({
  base: './',
  test: {
    include: ['test/**/*.test.ts'],
  },
})
