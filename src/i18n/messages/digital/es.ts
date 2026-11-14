import type de from "./de";

const digital: typeof de = {
  title: "Digital",
  product: "Digital (se entrega solo tras el pago)",
  shared: "Todos los compradores reciben lo mismo",
  note: "Nota para compradores",
  add: "Añadir",
  entries: "Nuevas entradas, una por línea",
  entry: "Entrada",
  variant: "Variante",
  available: "Disponible",
  sold: "Vendido",
  waiting: "Pagado, a la espera de entradas",
  show: "Mostrar",
  copy: "Copiar",
  copied: "Copiado",
  added: "{count} añadidas",
  order: "Pedido",
  status: {
    AVAILABLE: "Disponible",
    SOLD: "Vendido",
  },
  buyer: {
    title: "Tus artículos digitales",
    pending: "Estará disponible en breve",
  },
  short: "Pedido {order}: faltan {count} artículos digitales ({product})",
  mail: {
    subject: "Pedido {number}: tus artículos están listos",
    body: "Tus artículos digitales del pedido {number} están listos en la página de tu pedido. El enlace está en la confirmación del pedido.",
  },
  error: {
    NOT_DIGITAL: "No es un producto digital",
    EMPTY: "Sin entradas",
    TOO_MANY: "Como máximo 500 entradas a la vez, de 4000 caracteres",
    SOLD: "Ya vendido",
  },
};

export default digital;
