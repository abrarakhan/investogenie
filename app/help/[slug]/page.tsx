import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { HELP_ARTICLES, HELP_BY_SLUG } from "@/lib/help/articles";
import {
  HelpShell, Article, Eyebrow, Title, Lede, Meta, ArticleFooterNav,
} from "@/components/help/HelpLayout";

const CATEGORY_LABEL: Record<string, string> = {
  swing: "Swing Strategy",
  probability: "Probability",
  engine: "How it works",
};

export function generateStaticParams() {
  return HELP_ARTICLES.map((a) => ({ slug: a.slug }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const article = HELP_BY_SLUG[slug];
  if (!article) return { title: "Help — InvestoGenie" };
  return {
    title: `${article.title} — InvestoGenie Help`,
    description: article.summary,
  };
}

export default async function HelpArticlePage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const article = HELP_BY_SLUG[slug];
  if (!article) notFound();

  const { Body } = article;
  const meta = [CATEGORY_LABEL[article.category], `${article.readMins} min read`];
  if (article.trader) meta.splice(1, 0, article.trader);

  return (
    <HelpShell>
      <Article>
        <Eyebrow>{CATEGORY_LABEL[article.category]}</Eyebrow>
        <Title>{article.title}</Title>
        <Lede>{article.subtitle}</Lede>
        <Meta items={meta} />
        <div className="mt-2">
          <Body />
        </div>
        <ArticleFooterNav />
      </Article>
    </HelpShell>
  );
}
