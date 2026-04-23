package ru.link28rus.gmd.child

import android.accessibilityservice.AccessibilityService
import android.view.accessibility.AccessibilityEvent

// L2 PIN-lock убран в v0.29.2 — защита от удаления держится ТОЛЬКО на
// Device Admin L1 (как у «Где мои дети» и «Пинго»). Родитель переключает
// тумблер в кабинете; при OFF приложение само отзывает admin
// (`removeActiveAdmin`) и ребёнок может удалить через стандартный
// Settings → Apps. Без PIN-запросов.
//
// Класс и служебная запись в манифесте оставлены пустым no-op'ом: у уже
// включивших AccessibilityService пользователей Android увидит сервис
// зарегистрированным, но onAccessibilityEvent ничего не делает.
// Можно отключить в Settings — поведение защиты не изменится.
class GmdAccessibilityService : AccessibilityService() {
    override fun onAccessibilityEvent(event: AccessibilityEvent?) {
        // no-op — v0.29.2 removed PIN-lock gate
    }

    override fun onInterrupt() {
        // no-op
    }
}
