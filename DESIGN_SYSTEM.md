# Дизайн-система 1VPN Obsidian

## Цвет и типографика

| Роль | Значение |
| --- | --- |
| Фон | `#050506`, вторичный `#0b0c0f` |
| Поверхности | `#101114`, `#17191e`, `#202229` |
| Границы | `#292c33` |
| Текст | `#f5f5f7`, вторичный `#a0a4ae`, подписи `#8a8e99` |
| Акцент, наведение и выделенный текст | `#7788ff`, `#98a5ff`, `#b8c0ff` |
| Успех, предупреждение и ошибка | `#63d8a0`, `#f4bd69`, `#ff848c` |

Inter толщиной 400–800 загружается локально двумя WOFF2 с `font-display: swap`. Разделение кириллицы и латиницы позволяет браузеру загрузить подходящие наборы. Числа в статистике табличные. UUID и ссылки подписки используют системный моноширинный шрифт. Радиус карточки 18 px, поля 10 px. Используются текстовые обозначения состояний и заметная обводка фокуса.

## Компоненты

- `Button`, `ButtonLink` и `IconButton` применяют один набор размеров, включая основное, нейтральное и опасное действия. `PendingButton` отражает выполнение серверного действия. Кнопки с иконками получают доступные подписи.
- `Input`, `PasswordInput`, нативный select и `CheckField` используют общий стиль. `CheckField` поддерживает галочку и переключатель. `Tabs` поддерживает стрелки, Home и End и сохраняет заполненные поля в скрытых панелях.
- `Modal` строится на нативном dialog и поддерживает обычный, широкий и боковой варианты. Escape, фон, блокировка фонового скролла и возврат фокуса работают для всех вариантов. `ConfirmSubmit` проверяет ограничения формы и запрашивает подтверждение перед отправкой.
- `PageHeader`, `SectionHeader`, `Card` и `StatCard` задают иерархию страниц. `StatusBadge`, `Notice`, `ErrorState`, `EmptyState` и `Skeleton` описывают реальные состояния API, форм и загрузки.
- `DataTable` поддерживает ограниченный набор строк, фильтр и листание. На узком экране каждая ячейка получает видимую подпись. `ConsoleShell` содержит боковую панель и мобильные быстрые ссылки. `MobileNavigation` использует нативное раскрытие и закрывается по Escape.

## Движение и графика

Наведение и нажатие занимают около 160 мс, появление секций 280 мс, переход диалога 220 мс. Обновлённые значения баланса выводятся сразу с фактической точностью. Пульсация используется в скелете загрузки списка устройств. В режиме `prefers-reduced-motion` прокрутка мгновенная и длительность переходов сведена к минимуму.

Главная, вход и регистрация используют предоставленный логотип `public/1vpn-one-network.svg`. Колебание цифры, движущиеся точки на орбитах и пульсация сети работают внутри SVG. При `prefers-reduced-motion` логотип статичен. Размеры изображения заданы в разметке. Файлы Inter суммарно занимают 67 004 байта. Лицензия лежит рядом с ними в `public/fonts/OFL-Inter.txt`.

### Запрос для обложки предыдущей версии

> Use case: stylized-concept. Asset type: right-hand website hero illustration for a premium dark VPN product. Primary request: an abstract, sculptural three-dimensional obsidian tunnel, one thick toroidal ring with precise concentric machined grooves on its inner edges, a few inset graphite segments, and restrained pale periwinkle rim light. Realistic premium product rendering, black polished basalt and satin graphite titanium, refined soft specular light from the upper left, no neon flood. Wide 3:2 composition, centered object with entire ring visible and generous margin, angled in three-quarter view with aperture visible. Near-black #050506 studio background, especially dark and empty at the left and all edges so it blends into a monochrome black website. Indigo #7788FF accent only in fine reflected light, crisp fine material details. No people, no text, no letters, no symbols, no watermark, no interface screenshots, no additional objects. It should look like an editorial studio photograph of a physical sculptural object.
