# SwiftForge Desktop

Первая ветка IDE содержит настольную оболочку на Tauri 2, React и Monaco. В ней можно открыть локальную папку, раскрывать каталоги, переключать файлы и сохранять изменения. Monaco подсвечивает Swift, YAML, JSON и Markdown. Панель iPhone показывает AirPlay-поток внутри IDE. Подсказки SourceKit и сборка IPA идут отдельными ветками по [плану MVP](../docs/mvp-architecture.md).

## Запуск на Ubuntu

Нужны Node.js 22.12+, npm, Cargo, компилятор C и системные [зависимости Tauri 2](https://v2.tauri.app/start/prerequisites/#linux).

```bash
cd ide
npm ci
npm run tauri -- dev
```

Для запуска сборки со встроенными статическими ресурсами:

```bash
npm run tauri -- build --debug --no-bundle
./src-tauri/target/debug/swiftforge
```

В **Open folder** выберите копию `ios-probe/SDKProbe`. Раскройте `Sources/SDKProbe`, откройте `ContentView.swift`, измените текст и нажмите **Ctrl+S**. При удалении файла или изменении его внешним инструментом редактор покажет ошибку сохранения. Дерево фильтрует скрытые каталоги, `node_modules` и символические ссылки. В текущей версии открываются UTF-8-файлы размером до 2 МиБ.

## Панель iPhone

На Ubuntu понадобятся UxPlay 1.73 или новее с опцией `-vrtp`, GStreamer, декодер H.264 и плагины для RTP и JPEG. Пример установки из репозитория Ubuntu:

```bash
sudo apt install uxplay gstreamer1.0-tools gstreamer1.0-plugins-base gstreamer1.0-plugins-good gstreamer1.0-plugins-bad gstreamer1.0-libav
```

Запустите SwiftForge, нажмите **Start mirroring** и на iPhone в той же локальной сети выберите **Пункт управления → Повтор экрана → SwiftForge IDE**. Введите PIN из панели. **Stop mirroring** завершает локальные процессы и очищает изображение. Звук выключен. Управление приложением остаётся на телефоне.

SwiftForge запускает UxPlay как отдельный процесс. H.264 идёт через RTP по адресу `127.0.0.1` в GStreamer, который декодирует и передаёт кадры в окно Tauri. Сохраняется только последний кадр в оперативной памяти. Для локально распакованного UxPlay укажите абсолютный путь в `SWIFTFORGE_UXPLAY`. Если приёмник не появляется на iPhone, проверьте, что устройства находятся в одной локальной сети и Avahi запущен.
