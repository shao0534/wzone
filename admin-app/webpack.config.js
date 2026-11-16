const path = require('path');
const HtmlWebpackPlugin = require('html-webpack-plugin');
const { VueLoaderPlugin } = require('vue-loader');
const { name } = require('./package.json');

module.exports = {
  mode: 'development',
  entry: './src/main.js',
  output: {
    path: path.resolve(__dirname, 'dist'),
    filename: '[name].[contenthash:8].js',
    // 微前端下静态资源(字体/图片)必须用绝对路径指向子应用自身, 否则会被解析到主应用域名导致 404
    // 开发环境: 指向 admin-app 的 dev server(8002); 生产环境请改为子应用实际部署地址
    publicPath: process.env.NODE_ENV === 'production' ? '/' : '//localhost:8002/',
    library: `${name}-[name]`,      // qiankun 要求的 UMD 库名
    libraryTarget: 'umd',
    chunkLoadingGlobal: `webpackJsonp_${name}`, // 避免多应用全局变量冲突
    globalObject: 'window',
  },
  resolve: {
    extensions: ['.js', '.vue'],
    alias: { '@': path.resolve(__dirname, 'src') },
  },
  module: {
    rules: [
      { test: /\.vue$/, loader: 'vue-loader' },
      { test: /\.js$/, loader: 'babel-loader', exclude: /node_modules/ },
      { test: /\.less$/, use: ['vue-style-loader', 'css-loader', 'less-loader'] },
      { test: /\.css$/, use: ['vue-style-loader', 'css-loader'] },
      { test: /\.(png|jpe?g|gif|svg|woff2?|eot|ttf|otf)$/, type: 'asset' },
    ],
  },
  // vue-loader 15 对 <style> 使用 `import style0 from '...'`,
  // webpack 5 会误报 "export 'default' was not found"(样式实际已正常注入),
  // 这里精准屏蔽该误报, 保证构建输出干净
  ignoreWarnings: [
    {
      module: /\.vue$/,
      message: /export 'default' \(imported as 'style\d+'\) was not found/,
    },
  ],
  plugins: [
    new VueLoaderPlugin(),
    new HtmlWebpackPlugin({ template: './public/index.html' }),
  ],
  devServer: {
    port: 8002,
    headers: { 'Access-Control-Allow-Origin': '*' }, // 允许主应用跨域拉取
    historyApiFallback: true,
    client: {
      overlay: {
        warnings: false,
        // 运行时错误过滤: 浏览器扩展(React DevTools 等)在 qiankun 子应用卸载/重挂时
        // 会在扩展自身代码里抛错(如 "Cannot read properties of undefined (reading 'app')"),
        // 与本项目无关却会弹全屏红框 —— 来源为 chrome-extension:// 或该已知扩展报错不显示
        runtimeErrors: (error) => {
          const text = String((error && error.stack) || (typeof error === 'string' ? error : (error && error.message) || ''));
          if (text.includes('chrome-extension://')) return false;
          if (text.includes("reading 'app'")) return false;
          return true;
        },
      },
    },
  },
};
