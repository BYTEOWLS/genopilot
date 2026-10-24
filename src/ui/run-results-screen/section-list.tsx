import {UnorderedList} from "@inkjs/ui";
import {Box, Text} from "ink";
import React from "react";
import {mutedColor} from '../theme.js';
import {Section} from '../components/section.js';

export type SectionListProps = {
    title: string,
    description?: string,
    items: SectionListItem[],
    children?: React.ReactNode,
}

export type SectionListItem = {
    /** Stable identifier, independent of the displayed label. */
    id: string,
    label: string,
    value: string | number,
    row?: boolean,
    color?: string,
    dim?: boolean,
};

export function SectionList({
                                title,
                                description,
                                items,
                                children,
                            }: SectionListProps): React.JSX.Element {
    return (
        <Section title={title}>
            {description && (<Text italic>{description}</Text>)}
            <UnorderedList>
                {items.map(i => (<UnorderedList.Item key={i.id}>
                        <Box flexDirection={i.row ? "row" : "column"}>
                            <Text bold>{i.label}{i.row && (': ')}</Text>
                            <Text color={i.dim ? mutedColor : i.color}>
                                {i.value}
                            </Text>
                        </Box>
                    </UnorderedList.Item>
                ))
                }
            </UnorderedList>
            {children}
        </Section>
    )

}
