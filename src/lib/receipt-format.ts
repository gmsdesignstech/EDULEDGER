const ones = [
  "",
  "One",
  "Two",
  "Three",
  "Four",
  "Five",
  "Six",
  "Seven",
  "Eight",
  "Nine",
  "Ten",
  "Eleven",
  "Twelve",
  "Thirteen",
  "Fourteen",
  "Fifteen",
  "Sixteen",
  "Seventeen",
  "Eighteen",
  "Nineteen",
];
const tens = [
  "",
  "",
  "Twenty",
  "Thirty",
  "Forty",
  "Fifty",
  "Sixty",
  "Seventy",
  "Eighty",
  "Ninety",
];

function belowThousand(value: number) {
  const words: string[] = [];
  if (value >= 100) {
    words.push(ones[Math.floor(value / 100)], "Hundred");
    value %= 100;
  }
  if (value >= 20) {
    words.push(tens[Math.floor(value / 10)]);
    value %= 10;
  }
  if (value > 0) words.push(ones[value]);
  return words.join(" ");
}

export function amountInWords(amount: number) {
  let rupees = Math.floor(Math.max(0, amount));
  const parts: string[] = [];
  for (const [divisor, name] of [
    [10_000_000, "Crore"],
    [100_000, "Lakh"],
    [1_000, "Thousand"],
  ] as const) {
    const portion = Math.floor(rupees / divisor);
    if (portion) {
      parts.push(belowThousand(portion), name);
      rupees %= divisor;
    }
  }
  if (rupees) parts.push(belowThousand(rupees));
  if (!parts.length) parts.push("Zero");
  return `Rupees ${parts.join(" ")} Only`;
}

export function receiptDate(value: string) {
  const [year, month, day] = value.slice(0, 10).split("-");
  return year && month && day ? `${day}-${month}-${year}` : value;
}
