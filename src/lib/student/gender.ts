// Пол ученика по имени — только подсказка для анкеты (форм статусов «Королева/Король»); учитель всегда может поменять.
// Неоднозначные имена (Саша, Женя, Валя…) и непонятные латинские — не угадываем.

const MALE_A = new Set(["никита", "илья", "кузьма", "фома", "лука", "савва", "данила", "гаврила", "миша", "паша", "лёша", "леша", "дима", "коля", "петя", "ваня", "гоша", "вова", "сеня", "витя", "толя", "федя", "юра", "костя", "стёпа", "степа", "гриша", "лёва", "лева", "тёма", "тема", "боря", "рома", "серёжа", "сережа", "андрюша", "алёша", "алеша", "ярослава_", "жора", "яша", "митя", "добрыня", "эмиля"]);
const AMBIG = new Set(["саша", "женя", "валя", "слава", "шура", "сима", "юля_", "sasha", "zhenya", "evgenia_", "valya", "slava"]);
const FEMALE_SOFT = new Set(["любовь", "нинель", "эсфирь", "ассоль", "юдифь", "агарь", "руфь"]);
const MALE_LAT = new Set(["nikita", "ilya", "ilia", "misha", "dima", "kolya", "petya", "vanya", "pasha", "lesha", "alyosha", "grisha", "kostya", "yura", "fedya", "tolya", "vitya", "goga", "gosha", "luka", "luca", "sava", "savva", "foma", "kuzma", "danila", "roma", "borya", "tema", "lyova"]);

export function guessGender(name: string | null | undefined): "f" | "m" | null {
  const n = (name ?? "").trim().split(/\s+/)[0]?.toLowerCase().replace(/ё/g, "ё") ?? "";
  if (n.length < 2 || AMBIG.has(n)) return null;
  if (/^[а-яё-]+$/.test(n)) {
    if (MALE_A.has(n)) return "m";
    if (/[ая]$/.test(n)) return "f";
    if (n.endsWith("ь")) return FEMALE_SOFT.has(n) ? "f" : "m";
    if (/[бвгджзйклмнпрстфхцчшщ]$/.test(n)) return "m";
    return null;
  }
  if (/^[a-z-]+$/.test(n)) {
    if (MALE_LAT.has(n)) return "m";
    if (/(a|ya|ia)$/.test(n)) return "f"; // Anna, Olga, Maria, Natalya
    return null; // латиница без «-a» — не гадаем (Kate, Alex, Daniel…)
  }
  return null;
}
