-- An article had a name and nothing longer. The supplier item it was bought
-- as already carries a description (0032), and the New articles form now
-- starts from it: head office keeps it, edits it or clears it while setting
-- the delivery up, and the article remembers what they decided.
--
-- The setup session holds the decision until it is issued, because issuing
-- runs later, from the queue (article_setup_issue_queue), and must mint what
-- was decided at the desk rather than look the supplier item up again.
--
-- Additive only: the binary before this one never reads either column, so it
-- keeps working on this schema while a rollout replaces it.
ALTER TABLE article ADD COLUMN description text;
ALTER TABLE article_setup_session ADD COLUMN description text;
