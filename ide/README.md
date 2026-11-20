# SwiftForge Desktop

Первая ветка IDE содержит настольную оболочку на Tauri 2, React и Monaco. В ней можно открыть локальную папку, раскрывать каталоги, переключать файлы и сохранять изменения. Monaco подсвечивает Swift, YAML, JSON и Markdown. Подсказки SourceKit, сборка IPA и панель iPhone описаны в [плане MVP](../docs/mvp-architecture.md) и идут в отдельных ветках.

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
