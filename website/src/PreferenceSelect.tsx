import { Select } from "radix-ui";
import { Check, ChevronDown, type LucideIcon } from "lucide-react";

export function PreferenceSelect<T extends string>({ label, value, onChange, icon: Icon, options }: {
    label: string;
    value: T;
    onChange: (value: T) => void;
    icon: LucideIcon;
    options: { value: T; label: string; icon: LucideIcon }[];
}) {
    return <Select.Root value={value} onValueChange={(next) => onChange(next as T)}>
        <Select.Trigger className="preference-control" aria-label={label}
                        title={`${label}: ${options.find((option) => option.value === value)?.label}`}>
            <Icon size={17} aria-hidden="true" />
            <Select.Icon asChild><ChevronDown size={12} aria-hidden="true" /></Select.Icon>
        </Select.Trigger>
        <Select.Portal>
            <Select.Content className="preference-menu" position="popper" align="end" sideOffset={10} collisionPadding={12}>
                <Select.Viewport>
                    <Select.Group>
                        <Select.Label className="preference-menu-label">{label}</Select.Label>
                        {options.map(({ value: optionValue, label: optionLabel, icon: OptionIcon }) =>
                            <Select.Item key={optionValue} value={optionValue} data-value={optionValue} className="preference-option">
                                <OptionIcon size={16} aria-hidden="true" />
                                <Select.ItemText>{optionLabel}</Select.ItemText>
                                <Select.ItemIndicator className="preference-check"><Check size={15} /></Select.ItemIndicator>
                            </Select.Item>)}
                    </Select.Group>
                </Select.Viewport>
            </Select.Content>
        </Select.Portal>
    </Select.Root>;
}
