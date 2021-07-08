const path = require('path');
const HtmlWebpackPlugin = require('html-webpack-plugin');
const CopyWebpackPlugin = require('copy-webpack-plugin');
const TsconfigPathsPlugin = require('tsconfig-paths-webpack-plugin');



const mode = process.env.NODE_ENV === 'production'
    ? 'production'
    : 'development';


module.exports = [
    {
        mode,
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
        mode,
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
                    test: /\.node$/,
                    loader: 'node-loader',
                },
                {
                    test: /\.(png|jpe?g|gif|mov|pdf)$/i,
                    use: [
                        {
                            loader: 'file-loader',
                        },
                    ],
                },
                {
                    test: /\.css$/,
                    use: [
                      'style-loader',
                      'css-loader',
                    ],
                },
                {
                    test: /\.ts(x?)$/,
                    include: /source/,
                    use: [
                        {
                            loader: 'ts-loader',
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
                    { from: './yarn.lock', to: './' },
                    { from: './libraries/', to: './libraries/' },
                ],
            }),
        ],
    },
];
