# LangCity 3JS —— 任务脚本（just 或 just --list 查看全部命令）

set windows-shell := ["cmd.exe", "/C"]


# 默认：列出全部命令
default:
    @just --list

# 跑游戏 = variant-z（原版地图资产版），http://localhost:5173
run:
    cd variant-z && npm run dev -- --host

# 跑「纯程序化城市」那套（仓库根目录 src/，手写路网，不依赖 GLB），http://localhost:5174
run-city:
    npm run dev -- --host

# 装两套依赖（根目录 + variant-z）
setup:
    npm install
    cd variant-z && npm install

# 构建生产包（variant-z/dist/）
build:
    cd variant-z && npm run build

# 构建城市版生产包（dist/）
build-city:
    npm run build

# 预览生产包
preview:
    cd variant-z && npm run preview

# 安装到安卓（占位：接入 Capacitor 后把下面步骤换成真实命令）
install:
    @echo "安卓安装尚未接入，计划走 Capacitor 打包，流程："
    @echo "  1) npm i -D @capacitor/cli @capacitor/core @capacitor/android && npx cap init"
    @echo "  2) npx cap add android && just build && npx cap sync android"
    @echo "  3) cd android && gradlew assembleDebug && adb install -r app/build/outputs/apk/debug/app-debug.apk"
