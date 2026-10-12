import { defineConfig } from 'vite';

/* Build mínimo: o app continua sendo o index.html com o script inline.
   O Vite existe apenas para empacotar src/auth-sync.js e suas dependências
   npm (@netlify/identity), que não podem ser carregadas via <script> comum. */
export default defineConfig({
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    target: 'es2020'
  }
});
