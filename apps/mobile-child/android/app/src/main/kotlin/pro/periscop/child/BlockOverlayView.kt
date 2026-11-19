package pro.periscop.child

import android.content.Context
import android.content.res.ColorStateList
import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.graphics.drawable.RippleDrawable
import android.os.Build
import android.util.TypedValue
import android.view.Gravity
import android.view.View
import android.view.WindowInsets
import android.widget.Button
import android.widget.FrameLayout
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import kotlin.math.roundToInt

/** Вид окна паузы, отдельно от правил и управления окном доступа. */
internal class BlockOverlayView(
    context: Context,
    onHome: () -> Unit,
    onCall: () -> Unit,
) : ScrollView(context) {
    private val title = label(32f, Color.WHITE).apply {
        typeface = Typeface.create("sans-serif", Typeface.BOLD)
        if (Build.VERSION.SDK_INT >= 28) isAccessibilityHeading = true
    }
    private val detail = label(16f, MUTED).apply { text = "Приложения временно недоступны" }
    private val countdown = label(54f, Color.WHITE).apply {
        typeface = Typeface.MONOSPACE
        isSingleLine = true
        setAutoSizeTextTypeUniformWithConfiguration(26, 54, 1, TypedValue.COMPLEX_UNIT_SP)
    }
    private val timer = LinearLayout(context).apply {
        orientation = LinearLayout.VERTICAL
        gravity = Gravity.CENTER
        background = rounded(SURFACE, 24, OUTLINE)
        setPadding(dp(16), dp(16), dp(16), dp(14))
        addView(label(15f, MUTED).apply { text = "До конца паузы" }, matchWidth())
        addView(countdown, matchWidth())
    }

    init {
        isFillViewport = true
        background = GradientDrawable(GradientDrawable.Orientation.TOP_BOTTOM, intArrayOf(SURFACE, BACKGROUND))
        insetPadding(0, 0, 0, 0)
        setOnApplyWindowInsetsListener { _, insets ->
            applyInsets(insets)
            insets
        }

        val center = FrameLayout(context)
        val panel = object : LinearLayout(context) {
            override fun onMeasure(widthMeasureSpec: Int, heightMeasureSpec: Int) {
                val width = minOf(MeasureSpec.getSize(widthMeasureSpec), dp(420))
                super.onMeasure(MeasureSpec.makeMeasureSpec(width, MeasureSpec.EXACTLY), heightMeasureSpec)
            }
        }.apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER_HORIZONTAL
        }
        val lock = ImageView(context).apply {
            setImageResource(R.drawable.ic_pause_lock)
            background = rounded(ICON_SURFACE, 24)
            setPadding(dp(17), dp(17), dp(17), dp(17))
            importantForAccessibility = View.IMPORTANT_FOR_ACCESSIBILITY_NO
        }
        panel.addView(lock, LinearLayout.LayoutParams(dp(68), dp(68)))
        panel.addView(title, matchWidth(22))
        panel.addView(detail, matchWidth(6))
        panel.addView(timer, matchWidth(24))
        panel.addView(action("На главный экран", primary = true, onClick = onHome), matchWidth(24))
        panel.addView(action("Позвонить", primary = false, onClick = onCall), matchWidth(10))
        center.addView(panel, FrameLayout.LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.WRAP_CONTENT, Gravity.CENTER))
        addView(center, LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.WRAP_CONTENT))
    }

    fun render(screen: BlockScreen, nowMs: Long) {
        if (title.text != screen.title) title.text = screen.title
        val remaining = screen.countdown(nowMs)
        val visibility = if (remaining == null) View.GONE else View.VISIBLE
        if (timer.visibility != visibility) timer.visibility = visibility
        if (detail.visibility != visibility) detail.visibility = visibility
        if (remaining != null && countdown.text != remaining) countdown.text = remaining
    }

    private fun label(size: Float, color: Int) = TextView(context).apply {
        textSize = size
        setTextColor(color)
        gravity = Gravity.CENTER
    }

    private fun action(label: String, primary: Boolean, onClick: () -> Unit) = Button(context).apply {
        text = label
        isAllCaps = false
        textSize = 16f
        minHeight = dp(52)
        setPadding(dp(16), dp(10), dp(16), dp(10))
        setTextColor(if (primary) BACKGROUND else ACCENT)
        backgroundTintList = null
        stateListAnimator = null
        val fill = if (primary) rounded(ACCENT, 16) else rounded(SURFACE, 16, OUTLINE)
        background = RippleDrawable(ColorStateList.valueOf(0x337492BD), fill, null)
        setOnClickListener { onClick() }
    }

    private fun rounded(color: Int, radius: Int, border: Int? = null) = GradientDrawable().apply {
        setColor(color)
        cornerRadius = dp(radius).toFloat()
        if (border != null) setStroke(dp(1), border)
    }

    private fun matchWidth(top: Int = 0) = LinearLayout.LayoutParams(
        LayoutParams.MATCH_PARENT, LayoutParams.WRAP_CONTENT,
    ).apply { topMargin = dp(top) }

    @Suppress("DEPRECATION")
    private fun applyInsets(insets: WindowInsets) {
        if (Build.VERSION.SDK_INT >= 30) {
            val safe = insets.getInsets(WindowInsets.Type.systemBars() or WindowInsets.Type.displayCutout())
            insetPadding(safe.left, safe.top, safe.right, safe.bottom)
        } else {
            insetPadding(insets.systemWindowInsetLeft, insets.systemWindowInsetTop,
                insets.systemWindowInsetRight, insets.systemWindowInsetBottom)
        }
    }

    private fun insetPadding(left: Int, top: Int, right: Int, bottom: Int) =
        setPadding(dp(24) + left, dp(24) + top, dp(24) + right, dp(24) + bottom)

    private fun dp(value: Int): Int = (value * resources.displayMetrics.density).roundToInt()

    private companion object {
        val BACKGROUND = 0xFF0A1628.toInt()
        val SURFACE = 0xFF14243D.toInt()
        val ICON_SURFACE = 0xFF213D61.toInt()
        val OUTLINE = 0xFF536D91.toInt()
        val ACCENT = 0xFFC4DDFF.toInt()
        val MUTED = 0xFFB9CAE3.toInt()
    }
}
