import { defineConfig } from 'vite';
import path from 'node:path';



// https://vitejs.dev/config
export default defineConfig({
    resolve: {
        alias: [
            { find: '~source', replacement: path.resolve(__dirname, 'src') },
            { find: '~renderer-data', replacement: path.resolve(__dirname, 'src/app/modules/data') },
            { find: '~renderer-components', replacement: path.resolve(__dirname, 'src/app/modules/components') },
            { find: '~renderer-containers', replacement: path.resolve(__dirname, 'src/app/modules/containers') },
            { find: '~renderer-planes', replacement: path.resolve(__dirname, 'src/app/modules/planes') },
            { find: '~renderer-services', replacement: path.resolve(__dirname, 'src/app/modules/services') },
        ],
    },
});
