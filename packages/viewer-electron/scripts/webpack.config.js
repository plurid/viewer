const path = require('path');
const HtmlWebpackPlugin = require('html-webpack-plugin');
const CopyWebpackPlugin = require('copy-webpack-plugin');
const TsconfigPathsPlugin = require('tsconfig-paths-webpack-plugin');



module.exports = [
    {
        mode: 'development',
        entry: './source/index.ts',
        target: 'electron-main',
        resolve: {
            extensions: [".ts", ".tsx", ".js", ".jsx"],

            plugins: [
                new TsconfigPathsPlugin({
                    configFile: path.resolve(__dirname, '../tsconfig.json'),
                }),
            ],
        },
        module: {
            rules: [{
                test: /\.ts$/,
                include: /source/,
                use: [{ loader: 'ts-loader' }]
            }]
        },
        output: {
            path: path.join(__dirname, '../build'),
            filename: 'index.js'
        }
    },
    {
        mode: 'development',
        entry: './source/renderer/index.tsx',
        target: 'electron-renderer',
        devtool: 'source-map',
        resolve: {
            extensions: [".ts", ".tsx", ".js", ".jsx"],

            plugins: [
                new TsconfigPathsPlugin({
                    configFile: path.resolve(__dirname, '../tsconfig.json'),
                }),
            ],
        },
        module: {
            rules: [
                {
                    test: /\.ts(x?)$/,
                    include: /source/,
                    use: [
                        {
                            loader: 'ts-loader',
                        },
                    ],
                },
                {
                    test: /\.(png|jpe?g|gif|mov|pdf)$/i,
                    use: [
                        {
                            loader: 'file-loader',
                        },
                    ],
                  },
            ],
        },
        output: {
            path: path.join(__dirname, '../build'),
            filename: 'renderer.js'
        },
        plugins: [
            new HtmlWebpackPlugin({
                template: './source/window/index.html'
            }),
            new CopyWebpackPlugin({
                patterns: [
                    { from: './source/window/package.json', to: './package.json' },
                    { from: './source/assets/', to: './assets/' },
                ],
            }),
        ],
    },
];
