import { useQueries, useQuery } from "@tanstack/react-query"
import { useEffect, useState } from "react"

import type { ArticleDetail } from "@/lib/queries/articles"
import {
  articleImage,
  articleMainImage,
  procurementKeys,
} from "@/lib/queries/procurement"

/// The pictures an article has, at two levels.
///
/// A **main picture** belongs to the article, and every colour that has no
/// photograph of its own shows it. A colour can have **its own** — every size
/// of the red shirt is the same red shirt, so the photograph is filed per
/// colour, not per SKU. An article with only one picture keeps it on every
/// colour.
///
/// The main picture is the `main.jpg` beside the colour photographs; the
/// article's `image_url` column is what it falls back to for the articles that
/// were given a link before the picture could be uploaded.
export interface ArticlePictures {
  readonly main: string | null
  /// By colour digit. `null` for a colour on the main picture.
  readonly own: ReadonlyMap<string, string | null>
}

/// A photograph does not change, a presigned link expires. Ten minutes sits
/// inside the server's own read TTL, so this is as fresh as the answer it
/// caches.
const STALE = 10 * 60 * 1000

export function useArticlePictures(
  article: ArticleDetail | undefined
): ArticlePictures {
  const code = article?.article_code ?? ""
  const digits = article?.colours.map((way) => way.colour_digit) ?? []

  const main = useQuery({
    queryKey: procurementKeys.articleMainImage(code),
    queryFn: ({ signal }) => articleMainImage(code, signal),
    enabled: article !== undefined,
    staleTime: STALE,
  })
  const own = useQueries({
    queries: digits.map((digit) => ({
      queryKey: procurementKeys.articleImage(code, digit),
      queryFn: ({ signal }: { signal?: AbortSignal }) =>
        articleImage(code, digit, signal),
      staleTime: STALE,
    })),
  })

  return {
    main: main.data?.url ?? article?.image_url ?? null,
    own: new Map(digits.map((digit, at) => [digit, own[at]?.data?.url ?? null])),
  }
}

/// A picked file as a link the page can draw, revoked when the file goes.
///
/// Held in state and set from an effect rather than made in render: a strict
/// mount runs the cleanup once before the effect settles, and a link revoked
/// that way would leave the preview broken in development only.
export function useObjectUrl(file: File | null): string | null {
  const [url, setUrl] = useState<string | null>(null)
  useEffect(() => {
    if (file === null) {
      setUrl(null)
      return
    }
    const made = URL.createObjectURL(file)
    setUrl(made)
    return () => URL.revokeObjectURL(made)
  }, [file])
  return url
}
