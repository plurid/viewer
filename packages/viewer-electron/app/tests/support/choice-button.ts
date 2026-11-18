/**
 * A ChoiceButton's accessible name is its label, then the choice it shows ("Image output format
 * WebP"), so a voice command can say the words on the button. Tests find one by its label alone,
 * whatever it shows: `getByRole('button', { name: choiceLabel('Image output format') })`.
 */
export const choiceLabel =
  (label: string) =>
  (_name: string, element?: Element | null): boolean =>
    element?.getAttribute('aria-label') === label;
