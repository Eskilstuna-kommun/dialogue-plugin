const { merge } = require('webpack-merge');
const common = require('./webpack.common');

module.exports = merge(common, {
  output: {
    path: `${__dirname}/../../EK-extern/plugins/`,
    publicPath: '/build/js',
    filename: 'dialogue.js',
    libraryTarget: 'var',
    libraryExport: 'default',
    library: 'Dialogue'
  },
  mode: 'development',
  devtool: 'source-map',
  module: {
    rules: [
      {
        test: /\.(scss|css)$/,
        use: ['style-loader', 'css-loader', 'sass-loader']
      }
    ]
  },
  devServer: {
    static: './',
    port: 9008,
    devMiddleware: {
      writeToDisk: true
    }
  }
});
