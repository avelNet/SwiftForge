# SwiftForge

Технический эксперимент на Ubuntu 26.04.1 x86_64 от 20 ноября 2026 года. Цель — собрать приложение локально и запустить его на физическом iPhone без Mac, macOS и Mac-сервера.

| Проверка | Результат |
| --- | --- |
| Нативная компиляция Swift на Ubuntu | SwiftPM 6.4.2 собрал ELF, который вывел `SwiftForge: Linux Swift OK` |
| Сборка пакета iOS | Собран неподписанный IPA. Проверены ZIP, Info.plist и исполняемый Mach-O ARM64 для iOS 18+ со Swift-функцией |
| Сборка SwiftUI через xtool | Сгенерирован проект. Darwin SDK отсутствует, сборка остановилась при запросе Xcode.xip |
| iPhone по USB | Сопряжение подтверждено для iOS 26.4.2. После сбоя usbmuxd связь восстановлена, режим разработчика включён |
| Подпись, установка и запуск | IPA подписан и установлен через iLoader 2.4.2 на Ubuntu. Запуск и успешный вызов Swift подтверждены экраном и списком процессов |

## Повторить сборку

Понадобятся Swift 6.4.2 для Ubuntu, Clang, отдельный LLVM 21 из Ubuntu с `ld64.lld`, `llvm-objdump`, `llvm-nm` и Python 3. Линкер из дистрибутива Swift 6.4.2 отклонил платформу iOS. В примере пути соответствуют локально распакованным инструментам этой проверки.

```bash
export PATH="$PWD/.local/swift/usr/bin:$PATH"
swift build --package-path linux-smoke
./linux-smoke/.build/debug/LinuxSmoke

llvm="$PWD/.local/llvm/usr/lib/llvm-21/bin"
export LD_LIBRARY_PATH="$PWD/.local/llvm/usr/lib/x86_64-linux-gnu"
LD64="$llvm/ld64.lld" ./ios-probe/build.sh
LLVM_OBJDUMP="$llvm/llvm-objdump" LLVM_NM="$llvm/llvm-nm" ./ios-probe/verify.sh
```

Результат сохраняется в `ios-probe/dist/SwiftForgeProbe.ipa`. На Ubuntu проверяется структура архива и целевая платформа. На физическом iPhone с iOS 26.4.2 приложение показало `SwiftForge: Swift on iPhone OK`, если вызов Embedded Swift вернул ожидаемый результат.

В эксперименте окно и жизненный цикл реализованы на Objective-C. Swift компилируется в режиме Embedded. Собственные декларации и текстовые заглушки описывают только несколько публичных системных символов, используемых тестом. Реализации UIKit, Foundation и Objective-C поставляет сам iPhone. Для сборки не скачивался Apple SDK. В этой схеме не проверены импорт SwiftUI, обычный Swift с Apple SDK, сборка ресурсов, Xcode-проекты и публикация.

## Подпись и запуск

- Нужны сертификат разработки, соответствующий ключ и provisioning profile с разрешением для устройства и идентификатора приложения. Инструмент sideload может выбрать итоговый идентификатор при переподписи. Для личного теста Apple описывает бесплатную Personal Team с профилями на 7 дней. Инструменты Linux для бесплатной автоматической выдачи используют меняющиеся частные API Apple. [Apple Developer Account](https://developer.apple.com/help/account/basics/about-your-developer-account/)
- Бесплатная подпись и установка на Ubuntu выполнены через iLoader 2.4.2 и импорт собственного IPA. Для запуска iLoader на этой Ubuntu сработал извлечённый пакет `.deb` с системным WebKit. AppImage упал с `EGL_BAD_PARAMETER`. Для запуска приложения на iPhone требуется режим разработчика. [iLoader 2.4.2](https://github.com/nab138/iloader/releases/tag/v2.4.2) · [Apple Developer Mode](https://developer.apple.com/documentation/xcode/enabling-developer-mode-on-a-device)
- Сборка обычного SwiftUI-приложения вынесена в `ios-probe/SDKProbe`. Для неё xtool 1.24.0 ожидает Xcode 27.1 с портала Apple и Swift 6.4.x. Официальный архив требует входа в Apple Account. Журнал реальной попытки находится в `evidence/xtool-sdk-tty.txt`. [Инструкция xtool 1.24.0](https://github.com/xtool-org/xtool/blob/1.24.0/Documentation/xtool.docc/Installation-Linux.md)

## Инструменты и перспективы для SwiftForge

| Инструмент | Что известно |
| --- | --- |
| Swift 6.4.2 | Swift.org предоставляет официальный Linux toolchain. Проверенная сборка Embedded Swift использует iOS-модуль стандартной библиотеки из этого toolchain и отдельный Mach-O линкер. [Swift.org](https://www.swift.org/install/linux/ubuntu/26_04/) |
| xtool 1.24.0 | MIT. Основной технический кандидат для проектов SwiftPM. Умеет извлекать Darwin SDK из локального Xcode.xip и документирует команды сборки, подписи, установки и запуска. Для бесплатного входа использует частные API Apple. [xtool](https://github.com/xtool-org/xtool/tree/1.24.0) |
| CrossCode | IDE с открытым исходным кодом, генерация Darwin SDK из Xcode 26, сборка SwiftPM, подпись и установка через isideload. Полезный ориентир для интеграции редактора, LSP и устройства. [CrossCode](https://github.com/nab138/CrossCode) |
| KXBuild | Поставщик заявляет поддержку проектов Xcode, SwiftPM, подписи IPA и установки. У CLI есть отдельная активация лицензии и пробный период. В эксперименте его не запускали. [KXBuild](https://github.com/kxbuild/kxbuild) |

Редактор, LSP, SwiftPM и локальные Linux-сборки подходят для коммерческой IDE. Собранный IPA показывает, что Ubuntu может создавать нативный код для iPhone даже без Apple SDK, но узкие заглушки этого теста непригодны как универсальный SDK для разработки приложений. Штатную поддержку SwiftUI и Xcode-проектов пока обещать нельзя.

Работа с SDK Apple — отдельный вопрос. В Xcode and Apple SDKs Agreement, §§ 2.2, 2.5 и 2.7, Apple ограничивает использование Apple Software компьютерами Apple и запрещает его неразрешённое распространение. Самостоятельная загрузка архива пользователем не снимает вопрос о допустимости этого сценария на обычном ПК. Это ограничение нужно разрешить до коммерческой поставки интеграции с Apple SDK. Публикация в App Store также требует отдельного членства Apple, вне бюджета данного теста. [Лицензия Xcode и Apple SDK](https://www.apple.com/legal/sla/docs/xcode.pdf) · [Apple Developer Account](https://developer.apple.com/help/account/basics/about-your-developer-account/)

## Интерактивный тест

Первый IPA, `SwiftForge Probe`, использует UIKit. В [Objective-C точке входа](ios-probe/main.m) вызывается `UIApplicationMain`, создаются окно, контроллер и `UILabel`. Swift-функция из [Probe.swift](ios-probe/Probe.swift) возвращает число. Только при результате 42 на устройстве появляется `SwiftForge: Swift on iPhone OK`. Исполняемый Mach-O ARM64 создавался на Ubuntu, где `swiftc` 6.4.2 компилировал Swift в Embedded-режиме, Clang компилировал Objective-C, а Ubuntu `ld64.lld` 21.1.8 связывал объектные файлы. Копия приложения подписана через iLoader 2.4.2 и запущена на iPhone с iOS 26.4.2. [Проверка устройства](evidence/device.txt)

Второй IPA, `SwiftForge Counter`, включает нативные `UILabel`, `UIButton` и `UITextField`. Обработчик кнопки вызывает [функцию Embedded Swift](ios-probe/interactive/Counter.swift). [Код UIKit](ios-probe/interactive/main.m) сохраняет счётчик и текст через `NSUserDefaults` и читает их при запуске. Это отдельный идентификатор приложения и отдельный контейнер данных.

С теми же переменными окружения, что выше, выполните чистую сборку. Каждый запуск создаёт новый временный каталог объектов и пакета.

```bash
LD64="$llvm/ld64.lld" ./ios-probe/build.sh interactive
LLVM_OBJDUMP="$llvm/llvm-objdump" LLVM_NM="$llvm/llvm-nm" ./ios-probe/verify.sh --interactive
```

В iLoader выберите iPhone и импортируйте `ios-probe/dist/SwiftForgeCounter.ipa` для подписи и установки. На телефоне откройте **SwiftForge Counter**, дважды нажмите **Increment** и введите `SwiftForge test`. Закройте приложение через переключатель и откройте заново. Ожидаются `Count: 2` и введённый текст. Проверка пакета на Ubuntu и четыре теста Swift-функции прошли. Установка через iLoader и запущенный процесс подтверждены по USB. На физическом iPhone владелец проверил кнопку, ввод текста и сохранение обоих значений после полного закрытия и повторного запуска приложения. [Журнал установки](evidence/interactive-device.txt) [Журнал сборки](evidence/interactive-build.txt) · [Журнал тестов](evidence/interactive-linux-check.txt)

Отдельная [версия на SwiftUI](ios-probe/SDKProbe/Sources/SDKProbe/ContentView.swift) реализует те же элементы с `Button`, `TextField` и `@AppStorage`. Попытка `xtool dev build --ipa` остановилась на отсутствующем Darwin SDK. Прямая проверка `swiftc` остановилась на отсутствии стандартной библиотеки для обычного iOS-таргета. Рабочий интерактивный IPA использует UIKit и Foundation на устройстве. Сборка произвольных SwiftUI-приложений, ресурсов Xcode и расширений этим результатом не подтверждена. [Журнал SwiftUI](evidence/interactive-swiftui.txt)

## Экран физического iPhone на Ubuntu

Проверено локальное зеркалирование через AirPlay и UxPlay из пакета Ubuntu 1.73.2-1. После подключения через «Повтор экрана» на Ubuntu видно SwiftForge Counter, запущенный на физическом iPhone. Пользователь взаимодействует с элементами на телефоне, а UxPlay отображает видеопоток в отдельном окне. Встраивание потока в IDE будет отдельной задачей. [Журнал теста](evidence/iphone-mirroring.txt)
