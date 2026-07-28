"use client";

import {
	createContext,
	useContext,
	type ButtonHTMLAttributes,
	type ImgHTMLAttributes,
	type ReactNode,
} from "react";

/** Declarative image payload consumed by the shell-owned detail modal. */
export interface DetailImageSpec {
	src: string;
	alt: string;
}

type OpenDetailImage = (image: DetailImageSpec) => void;

const DetailImageModalContext = createContext<OpenDetailImage | null>(null);

/**
 * Connects renderer-owned thumbnail buttons to the detail shell's one modal.
 * The provider owns no state or chrome; DetailShell supplies both.
 */
export function DetailImageModalProvider({
	onOpen,
	children,
}: {
	onOpen: OpenDetailImage;
	children: ReactNode;
}) {
	return (
		<DetailImageModalContext.Provider value={onOpen}>
			{children}
		</DetailImageModalContext.Provider>
	);
}

export interface DetailImageTriggerProps
	extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "type" | "onClick"> {
	image: DetailImageSpec;
	imageClassName?: string;
	imageProps?: Omit<
		ImgHTMLAttributes<HTMLImageElement>,
		"src" | "alt" | "className"
	>;
}

/**
 * The shared, keyboard-native thumbnail affordance. Renderers declare only
 * the image to open; the nearest DetailShell owns the dialog behavior.
 */
export function DetailImageTrigger({
	image,
	imageClassName,
	imageProps,
	"aria-label": ariaLabel,
	...buttonProps
}: DetailImageTriggerProps) {
	const openImage = useContext(DetailImageModalContext);
	return (
		<button
			{...buttonProps}
			type="button"
			data-detail-image-modal-trigger=""
			aria-haspopup="dialog"
			aria-label={ariaLabel ?? `Open ${image.alt}`}
			onClick={() => openImage?.(image)}
		>
			<img
				{...imageProps}
				src={image.src}
				alt={image.alt}
				className={imageClassName}
			/>
		</button>
	);
}
