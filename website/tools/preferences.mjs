export async function selectPreference(page, label, value) {
    await page.getByRole("combobox", { name: label, exact: true }).click();
    await page.getByRole("option").and(page.locator(`[data-value="${value}"]`)).click();
}
