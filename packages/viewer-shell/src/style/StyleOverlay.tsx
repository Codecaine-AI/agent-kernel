import type { CSSProperties } from "react";

import type { GrainSettings } from "./style-settings";

type StyleOverlayProps = {
	settings: GrainSettings;
};

export function StyleOverlay({ settings }: StyleOverlayProps) {
	const contrastIntercept = (1 - settings.contrast) / 2;
	const grainStyle = {
		"--grain-opacity": settings.enabled ? settings.opacity * settings.softening.background : 0,
		"--grain-blend-mode": settings.blendMode
	} as CSSProperties;
	const normalStyle = {
		"--normal-opacity": settings.svgNormal.enabled ? settings.svgNormal.opacity : 0
	} as CSSProperties;

	return (
		<>
			<div aria-hidden="true" className="research-normal-layer" style={normalStyle}>
				<svg className="h-full w-full" focusable="false" preserveAspectRatio="none">
					<filter id="research-normal-map-filter" colorInterpolationFilters="sRGB">
						<feTurbulence
							baseFrequency={String(settings.svgNormal.frequency)}
							numOctaves="2"
							seed="17"
							stitchTiles="stitch"
							type="fractalNoise"
							result="normal-noise"
						/>
						<feDiffuseLighting
							diffuseConstant="1.18"
							in="normal-noise"
							lightingColor="#ffffff"
							result="normal-light"
							surfaceScale={String(settings.svgNormal.depth)}
						>
							<feDistantLight
								azimuth={String(settings.svgNormal.azimuth)}
								elevation={String(settings.svgNormal.elevation)}
							/>
						</feDiffuseLighting>
						<feFlood floodColor="#808080" result="normal-base" />
						<feBlend in="normal-base" in2="normal-light" mode="overlay" />
					</filter>
					<rect filter="url(#research-normal-map-filter)" height="100%" width="100%" />
				</svg>
			</div>
			<div aria-hidden="true" className="research-grain-layer" style={grainStyle}>
				<svg className="h-full w-full" focusable="false" preserveAspectRatio="none">
					<filter id="research-grain-filter" colorInterpolationFilters="sRGB">
						<feTurbulence
							baseFrequency={String(settings.frequency)}
							numOctaves="2"
							seed="7"
							stitchTiles="stitch"
							type="fractalNoise"
						/>
						<feColorMatrix type="saturate" values="0" />
						<feComponentTransfer>
							<feFuncR type="linear" slope={String(settings.contrast)} intercept={String(contrastIntercept)} />
							<feFuncG type="linear" slope={String(settings.contrast)} intercept={String(contrastIntercept)} />
							<feFuncB type="linear" slope={String(settings.contrast)} intercept={String(contrastIntercept)} />
						</feComponentTransfer>
					</filter>
					<rect filter="url(#research-grain-filter)" height="100%" width="100%" />
				</svg>
			</div>
		</>
	);
}
