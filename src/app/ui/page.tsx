import { AppHeader } from "@/components/AppHeader";
import { Icon } from "@/components/Icon";
import { ICONS, EXTRA_ICONS, type IconName } from "@/components/icon-paths";
import { getT } from "@/lib/i18n/server";

export const metadata = { title: "Design system" };

const COLORS = ["accent", "ok", "warn", "bad", "violet", "text", "text2", "text3", "sep", "fill", "surface2", "bg"];

export default async function UiKit() {
  const { t } = await getT();
  return (
    <>
      <AppHeader subtitle={t("ws.ui")} />
      <main className="main">
        <div className="page">
          <h1 className="mb-6">{t("ws.ui")}</h1>

          <section className="card">
            <h2 className="mb-4">Цвета</h2>
            <div className="grid-4">
              {COLORS.map((c) => (
                <div key={c} className="tile flex items-center gap-3">
                  <span className="h-9 w-9 rounded-xl border border-sep" style={{ background: `var(--${c})` }} />
                  <span className="small font-semibold">--{c}</span>
                </div>
              ))}
            </div>
            <div className="mt-6 flex flex-wrap items-baseline gap-6">
              <h1>Заголовок 30</h1><h2>Заголовок 22</h2><h3>Заголовок 17</h3><span>Текст 15</span>
              <span className="small muted">Мелкий 13</span><span className="hint">Подсказка курсивом</span>
            </div>
            <div className="gname mt-4">Elvira</div>
          </section>

          <section className="card">
            <h2 className="mb-4">Кнопки</h2>
            <div className="flex flex-wrap gap-3">
              <button className="btn primary"><Icon name="class" />Открыть класс</button>
              <button className="btn secondary">Вторичная</button>
              <button className="btn tinted">Тонированная</button>
              <button className="btn plain">Ссылка<Icon name="right" size="sm" /></button>
              <button className="btn danger">Отменить</button>
              <button className="btn primary sm">Маленькая</button>
              <button className="btn primary lg">Сделать домашку</button>
              <button className="btn primary" disabled>Недоступна</button>
              <button className="iconbtn" aria-label="Закрыть"><Icon name="close" /></button>
            </div>
          </section>

          <section className="card">
            <h2 className="mb-4">Сегменты, метки, переключатели</h2>
            <div className="flex flex-wrap items-center gap-4">
              <div className="seg"><button aria-pressed="true">Анкета</button><button>Прогресс</button><button>Маршрут</button><button>Фидбэк</button></div>
              <span className="pill blue"><Icon name="inbox" size="sm" />На проверку</span>
              <span className="pill green">Проверено</span>
              <span className="pill orange">Ждём</span>
              <span className="pill red">Не сделано</span>
              <span className="pill grey">Нет домашки</span>
              <span className="pill violet">B1 → B2+</span>
              <label className="switch"><input type="checkbox" defaultChecked aria-label="switch" /><span /></label>
              <label className="switch"><input type="checkbox" aria-label="switch" /><span /></label>
              <input type="checkbox" className="check" defaultChecked aria-label="check" />
            </div>
          </section>

          <section className="card">
            <h2 className="mb-4">Поля и подсказки</h2>
            <div className="grid-2">
              <div className="field"><label htmlFor="f1">Имя</label><input id="f1" className="input" placeholder="Анна" /></div>
              <div className="field"><label htmlFor="f2">Почта</label><input id="f2" className="input" defaultValue="anna@" aria-invalid="true" /><span className="ferr">Проверьте адрес почты</span></div>
              <div className="field"><label htmlFor="f3">Уровень</label><select id="f3" className="select"><option>B1</option><option>B2</option></select></div>
              <div className="field"><label htmlFor="f4">Заметка</label><textarea id="f4" className="textarea" placeholder="Повторить Present Perfect" /></div>
            </div>
            <details className="how mt-4"><summary>ⓘ Как это работает</summary>Свёрнутый блок с подсказкой — единый стиль для всех разделов.</details>
          </section>

          <section className="card">
            <h2 className="mb-4">Список и плитки</h2>
            <div className="list" style={{ background: "var(--surface2)" }}>
              <div className="row"><span className="avatar lg">AK</span><div className="grow"><div className="t">Anna Kuznetsova</div><div className="s">10:00 · Начнётся через 15 минут</div></div><button className="btn primary sm">Открыть класс</button></div>
              <div className="row"><span className="avatar lg" style={{ background: "var(--ok-bg)", color: "var(--ok-text)" }}>MD</span><div className="grow"><div className="t">Mikhail Denisov</div><div className="s">08:30</div></div><span className="pill blue">На проверку</span></div>
            </div>
            <div className="grid-3 mt-4">
              <div className="tile"><div className="l">Заработано</div><div className="v">84 000 ₽</div></div>
              <div className="tile"><div className="l">Ждём</div><div className="v">12 000 ₽</div></div>
              <div className="tile"><div className="l">Предоплачено</div><div className="v">30 000 ₽</div></div>
            </div>
          </section>

          <section className="card">
            <h2 className="mb-4">Иконки</h2>
            <div className="flex flex-wrap gap-2">
              {(Object.keys({ ...ICONS, ...EXTRA_ICONS }) as IconName[]).map((n) => (
                <span key={n} title={n} className="flex h-10 w-10 items-center justify-center rounded-xl bg-surface2"><Icon name={n} /></span>
              ))}
            </div>
          </section>
        </div>
      </main>
    </>
  );
}
