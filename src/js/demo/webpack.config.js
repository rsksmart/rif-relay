const path = require('path')

const basepath = path.dirname(__filename);

module.exports = {
    entry: path.resolve(basepath, 'app/app.js'),
    mode: 'development',
    output: {
        path: path.resolve(basepath, 'public'),
        filename: 'app.js'
    },
    devtool: 'source-map',
}
