const path = require('path')
const { IgnorePlugin } = require('webpack')
const nodeExternals = require('webpack-node-externals')

module.exports = {
  plugins: [
    //      new BundleAnalyzerPlugin()
    new IgnorePlugin(/electron/),
    new IgnorePlugin(/^scrypt$/)
  ],
  target: 'node',
  entry: './dist/src/relayserver/runServer.js',
  mode: 'development',
  module: {
    rules: [
      {
        test: /\.tsx?$/,
        use: 'ts-loader',
        exclude: /node_modules/
      }
    ]
  },
  output: {
    path: path.resolve(__dirname, 'dist'),
    filename: 'relayserver.js'
  },
  externals: [nodeExternals()]
}
