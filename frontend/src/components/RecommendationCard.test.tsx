import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { RecommendationCard } from "./RecommendationCard";
import type { Recommendation } from "../types";

const baseRecommendation: Recommendation = {
  studioId: "studio-001",
  score: 85,
  facilityTags: ["鏡張り", "フローリング"],
  reason: "口コミ評価が高く、期待できます。",
  distance: 20,
  cost: 0,
  ratingScore: 90,
  popularityScore: 80,
  studio: { studioId: "studio-001", name: "テストスタジオ", lat: 35.6, lng: 139.7 },
};

describe("RecommendationCard", () => {
  it("renders studio name, score, and facility tags", () => {
    render(
      <RecommendationCard
        recommendation={baseRecommendation}
        isFavorite={false}
        onToggleFavorite={vi.fn()}
        onClick={vi.fn()}
      />
    );

    expect(screen.getByText("テストスタジオ")).toBeInTheDocument();
    expect(screen.getByText("85")).toBeInTheDocument();
    expect(screen.getByText("鏡張り")).toBeInTheDocument();
    expect(screen.getByText("フローリング")).toBeInTheDocument();
  });

  it("shows a rank badge only when rank is provided", () => {
    const { rerender } = render(
      <RecommendationCard
        recommendation={baseRecommendation}
        isFavorite={false}
        onToggleFavorite={vi.fn()}
        onClick={vi.fn()}
      />
    );
    expect(screen.queryByText("#1")).not.toBeInTheDocument();

    rerender(
      <RecommendationCard
        recommendation={baseRecommendation}
        rank={1}
        isFavorite={false}
        onToggleFavorite={vi.fn()}
        onClick={vi.fn()}
      />
    );
    expect(screen.getByText("#1")).toBeInTheDocument();
  });

  it("calls onClick with the recommendation when the card is clicked", () => {
    const handleClick = vi.fn();
    render(
      <RecommendationCard
        recommendation={baseRecommendation}
        isFavorite={false}
        onToggleFavorite={vi.fn()}
        onClick={handleClick}
      />
    );

    fireEvent.click(screen.getByText("テストスタジオ"));
    expect(handleClick).toHaveBeenCalledWith(baseRecommendation);
  });

  it("shows the hero photo only when rank is set and the studio has an image", () => {
    const withImage: Recommendation = {
      ...baseRecommendation,
      studio: { ...baseRecommendation.studio!, imageUrl: "https://example.com/photo.jpg" },
    };

    const { rerender } = render(
      <RecommendationCard
        recommendation={withImage}
        isFavorite={false}
        onToggleFavorite={vi.fn()}
        onClick={vi.fn()}
      />
    );
    expect(screen.queryByRole("img", { name: "テストスタジオ" })).not.toBeInTheDocument();

    rerender(
      <RecommendationCard
        recommendation={withImage}
        rank={1}
        isFavorite={false}
        onToggleFavorite={vi.fn()}
        onClick={vi.fn()}
      />
    );
    expect(screen.getByRole("img", { name: "テストスタジオ" })).toHaveAttribute(
      "src",
      "https://example.com/photo.jpg"
    );

    rerender(
      <RecommendationCard
        recommendation={baseRecommendation}
        rank={1}
        isFavorite={false}
        onToggleFavorite={vi.fn()}
        onClick={vi.fn()}
      />
    );
    expect(screen.queryByRole("img", { name: "テストスタジオ" })).not.toBeInTheDocument();
  });

  it("calls onToggleFavorite with the studioId when the favorite button is clicked", () => {
    const handleToggle = vi.fn();
    render(
      <RecommendationCard
        recommendation={baseRecommendation}
        isFavorite={false}
        onToggleFavorite={handleToggle}
        onClick={vi.fn()}
      />
    );

    fireEvent.click(screen.getByText("保存"));
    expect(handleToggle).toHaveBeenCalledWith("studio-001");
  });
});
