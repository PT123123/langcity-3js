# LangCity 3JS —— 任务脚本（just 或 just --list 查看全部命令）

set windows-shell := ["cmd.exe", "/C"]


# 默认：列出全部命令
default:
    @just --list

# 在电脑上跑主项目（开发模式；--host 让同一 WiFi 下的手机也能打开调试）
run:
    npm run dev -- --host

# 在电脑上跑 variant-z（原版地图资产版）
run-z:
    cd variant-z && npm run dev -- --host

# 构建主项目生产包（dist/）
build:
    npm run build

# 构建 variant-z 生产包（variant-z/dist/）
build-z:
    cd variant-z && npm run build

# 预览主项目生产包
preview:
    npm run preview

# 安装到安卓（占位：接入 Capacitor 后把下面步骤换成真实命令）
install:
    @echo "安卓安装尚未接入，计划走 Capacitor 打包，流程："
    @echo "  1) npm i -D @capacitor/cli @capacitor/core @capacitor/android && npx cap init"
    @echo "  2) npx cap add android && just build && npx cap sync android"
    @echo "  3) cd android && gradlew assembleDebug && adb install -r app/build/outputs/apk/debug/app-debug.apk"
