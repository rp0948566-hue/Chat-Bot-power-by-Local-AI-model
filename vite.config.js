import { defineConfig } from 'vite';

export default defineConfig({
  optimizeDeps: {
    include: ['@supabase/supabase-js']
  },
  esbuild: {
    target: 'esnext'
  }
});